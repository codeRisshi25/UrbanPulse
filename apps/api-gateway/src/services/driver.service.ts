import redis from '../utils/redis.js';
import prisma from '../utils/db.js';
import logger from '../logger.js';
import { Prisma } from '@prisma/client';

/** Redis GEO set key for all active drivers */
const DRIVERS_GEO_KEY = 'drivers:active';
/** TTL for driver heartbeat in seconds */
const HEARTBEAT_TTL_SECONDS = 60;

/**
 * Default search radius in km used when querying nearby trips for a driver.
 * TODO: Move to packages/common constants or environment config in a future iteration.
 */
export const DRIVER_SEARCH_RADIUS_KM = 5;

const heartbeatKey = (driverId: string) => `driver:heartbeat:${driverId}`;

export interface DriverServiceResponse {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/**
 * Go online: update DB first, then write to Redis GEO + set heartbeat TTL.
 * DB-first order ensures Redis is only written after the source-of-truth is updated.
 */
export const setDriverOnline = async (
  userId: string,
  location: [number, number]
): Promise<DriverServiceResponse> => {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) {
    return { success: false, message: 'Driver profile not found' };
  }

  // Update DB first — if this fails, Redis is never touched
  await prisma.driver.update({ where: { id: driver.id }, data: { isActive: true } });

  const [lon, lat] = location;
  await redis.geoadd(DRIVERS_GEO_KEY, lon, lat, driver.id);
  await redis.set(heartbeatKey(driver.id), '1', 'EX', HEARTBEAT_TTL_SECONDS);

  logger.info({ driverId: driver.id, lon, lat }, 'Driver went online');
  return { success: true, message: 'Driver is now online' };
};

/**
 * Go offline: update DB first, then remove from Redis GEO + clear heartbeat TTL.
 * DB-first order ensures Redis cleanup only happens after source-of-truth is updated.
 */
export const setDriverOffline = async (userId: string): Promise<DriverServiceResponse> => {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) {
    return { success: false, message: 'Driver profile not found' };
  }

  // Update DB first — if this fails, Redis is not modified
  await prisma.driver.update({ where: { id: driver.id }, data: { isActive: false } });

  await redis.zrem(DRIVERS_GEO_KEY, driver.id);
  await redis.del(heartbeatKey(driver.id));

  logger.info({ driverId: driver.id }, 'Driver went offline');
  return { success: true, message: 'Driver is now offline' };
};

/**
 * Update location: verify driver is present in Redis GEO set via zscore before updating.
 * Guards against race conditions where DB shows active but Redis entry already expired.
 */
export const updateDriverLocation = async (
  userId: string,
  location: [number, number]
): Promise<DriverServiceResponse> => {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) {
    return { success: false, message: 'Driver profile not found' };
  }

  if (!driver.isActive) {
    return { success: false, message: 'Driver must be online to update location' };
  }

  // Confirm driver is actually present in GEO set (guards against stale DB state)
  const score = await redis.zscore(DRIVERS_GEO_KEY, driver.id);
  if (score === null) {
    logger.warn({ driverId: driver.id }, 'Driver not present in GEO set when updating location');
    return { success: false, message: 'Driver must be online to update location' };
  }

  const [lon, lat] = location;
  await redis.geoadd(DRIVERS_GEO_KEY, lon, lat, driver.id);
  await redis.set(heartbeatKey(driver.id), '1', 'EX', HEARTBEAT_TTL_SECONDS);

  logger.info({ driverId: driver.id, lon, lat }, 'Driver location updated');
  return { success: true, message: 'Location updated' };
};

/**
 * Get nearby REQUESTED trips within DRIVER_SEARCH_RADIUS_KM for a given driver.
 * Retrieves driver's position from Redis GEO, then queries PostGIS ST_DWithin.
 * Filters out ghost drivers (heartbeat expired) from the GEO set implicitly via
 * the driver's own heartbeat check.
 */
export const getNearbyAvailableRides = async (
  userId: string
): Promise<DriverServiceResponse> => {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) {
    return { success: false, message: 'Driver profile not found' };
  }

  if (!driver.isActive) {
    return { success: false, message: 'Driver must be online to see available rides' };
  }

  // Get driver position from Redis GEO
  const positions = await redis.geopos(DRIVERS_GEO_KEY, driver.id);
  if (!positions || !positions[0]) {
    return { success: false, message: 'Driver location not found in Redis' };
  }

  const [lonStr, latStr] = positions[0] as [string, string];
  const lon = parseFloat(lonStr);
  const lat = parseFloat(latStr);
  const radiusMeters = DRIVER_SEARCH_RADIUS_KM * 1000;

  // Use Prisma.sql tagged template for safe parameterized query
  const rides = await prisma.$queryRaw<
    {
      id: string;
      riderId: string;
      pickupLocation: string;
      dropoffLocation: string;
      status: string;
      createdAt: Date;
    }[]
  >(Prisma.sql`
    SELECT 
      id,
      "riderId",
      ST_AsText("pickupLocation") as "pickupLocation",
      ST_AsText("dropoffLocation") as "dropoffLocation",
      status,
      "createdAt"
    FROM "Trip"
    WHERE status = 'REQUESTED'
      AND ST_DWithin(
        "pickupLocation"::geography,
        ST_SetSRID(ST_MakePoint(${lon}, ${lat}), 4326)::geography,
        ${radiusMeters}
      )
    ORDER BY "createdAt" ASC
  `);

  return {
    success: true,
    message: 'Available rides fetched',
    data: { rides },
  };
};
