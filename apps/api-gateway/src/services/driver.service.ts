import redis from '../utils/redis.js';
import prisma from '../utils/db.js';
import logger from '../logger.js';

/** Redis GEO set key for all active drivers */
const DRIVERS_GEO_KEY = 'drivers:active';
/** TTL for driver heartbeat in seconds */
const HEARTBEAT_TTL_SECONDS = 60;
/** Default search radius in km */
export const DRIVER_SEARCH_RADIUS_KM = 5;

const heartbeatKey = (driverId: string) => `driver:heartbeat:${driverId}`;

export interface DriverServiceResponse {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

/** Go online: GEOADD to Redis, update DB isActive, set heartbeat TTL */
export const setDriverOnline = async (
  userId: string,
  location: [number, number]
): Promise<DriverServiceResponse> => {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) {
    return { success: false, message: 'Driver profile not found' };
  }

  const [lon, lat] = location;
  await redis.geoadd(DRIVERS_GEO_KEY, lon, lat, driver.id);
  await redis.set(heartbeatKey(driver.id), '1', 'EX', HEARTBEAT_TTL_SECONDS);

  await prisma.driver.update({ where: { id: driver.id }, data: { isActive: true } });

  logger.info({ driverId: driver.id, lon, lat }, 'Driver went online');
  return { success: true, message: 'Driver is now online' };
};

/** Go offline: ZREM from Redis GEO, remove heartbeat, update DB isActive */
export const setDriverOffline = async (userId: string): Promise<DriverServiceResponse> => {
  const driver = await prisma.driver.findUnique({ where: { userId } });
  if (!driver) {
    return { success: false, message: 'Driver profile not found' };
  }

  await redis.zrem(DRIVERS_GEO_KEY, driver.id);
  await redis.del(heartbeatKey(driver.id));

  await prisma.driver.update({ where: { id: driver.id }, data: { isActive: false } });

  logger.info({ driverId: driver.id }, 'Driver went offline');
  return { success: true, message: 'Driver is now offline' };
};

/** Update location: GEOADD (overwrites existing), refresh heartbeat TTL */
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

  const [lon, lat] = location;
  await redis.geoadd(DRIVERS_GEO_KEY, lon, lat, driver.id);
  await redis.set(heartbeatKey(driver.id), '1', 'EX', HEARTBEAT_TTL_SECONDS);

  logger.info({ driverId: driver.id, lon, lat }, 'Driver location updated');
  return { success: true, message: 'Location updated' };
};

/**
 * Get nearby REQUESTED trips within DRIVER_SEARCH_RADIUS_KM for a given driver.
 * Retrieves driver's position from Redis GEO, then queries PostGIS.
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

  const [lon, lat] = positions[0] as [string, string];
  const radiusMeters = DRIVER_SEARCH_RADIUS_KM * 1000;

  const rides = await prisma.$queryRaw<
    {
      id: string;
      riderId: string;
      pickupLocation: string;
      dropoffLocation: string;
      status: string;
      createdAt: Date;
    }[]
  >`
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
        ST_SetSRID(ST_MakePoint(${parseFloat(lon)}, ${parseFloat(lat)}), 4326)::geography,
        ${radiusMeters}
      )
    ORDER BY "createdAt" ASC
  `;

  return {
    success: true,
    message: 'Available rides fetched',
    data: { rides },
  };
};
