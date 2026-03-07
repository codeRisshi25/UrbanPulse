import { Queue } from 'bullmq';
import { QUEUE_NAMES, RIDE_LOCK_KEY_PREFIX } from 'common';
import logger from '../logger.js';
import prisma from '../utils/db.js';
import redis from '../utils/redis.js';
import type { RideInput } from 'common';

const bullmqConnection = {
  host: process.env.REDIS_HOST || 'localhost',
  port: Number(process.env.REDIS_PORT) || 6379,
} as const;

const rideRequestsQueue = new Queue(QUEUE_NAMES.RIDE_REQUESTS, {
  connection: bullmqConnection,
});

const rideLifecycleQueue = new Queue(QUEUE_NAMES.RIDE_LIFECYCLE, {
  connection: bullmqConnection,
});

const rideMatchingQueue = new Queue(QUEUE_NAMES.RIDE_MATCHING, {
  connection: bullmqConnection,
});

// Graceful shutdown — close BullMQ queues to prevent connection leaks
let shutdownRegistered = false;

const registerQueuesShutdown = (): void => {
  if (shutdownRegistered) return;
  shutdownRegistered = true;

  const queues = [rideRequestsQueue, rideLifecycleQueue, rideMatchingQueue];
  const shutdown = async (): Promise<void> => {
    try {
      await Promise.all(queues.map((q) => q.close()));
    } catch (error) {
      logger.error(error, 'Error closing BullMQ queues during shutdown');
    }
  };

  process.once('beforeExit', () => { void shutdown(); });
  (['SIGINT', 'SIGTERM', 'SIGQUIT'] as NodeJS.Signals[]).forEach((signal) => {
    process.once(signal, () => { void shutdown(); });
  });
};

registerQueuesShutdown();

export interface RideResponse {
  success: boolean;
  message: string;
  data?: Record<string, unknown>;
}

// ─── CREATE RIDE ──────────────────────────────────────────────────────────

export const createRide = async (input: RideInput, riderId: string): Promise<RideResponse> => {
  try {
    const { pickupLocation, dropoffLocation } = input;

    const rider = await prisma.rider.findUnique({
      where: { userId: riderId },
    });

    if (!rider) {
      return { success: false, message: 'Rider not found' };
    }

    const result = await prisma.$queryRaw<
      {
        id: string;
        riderId: string;
        pickupLocation: string;
        dropoffLocation: string;
        status: string;
        createdAt: Date;
      }[]
    >`
      INSERT INTO "Trip" ("riderId", "pickupLocation", "dropoffLocation", "status")
      VALUES (
        ${rider.id}, 
        ST_GeomFromText(${`POINT(${pickupLocation[0]} ${pickupLocation[1]})`}, 4326),
        ST_GeomFromText(${`POINT(${dropoffLocation[0]} ${dropoffLocation[1]})`}, 4326),
        'REQUESTED'
      )
      RETURNING 
        id, 
        "riderId", 
        ST_AsText("pickupLocation") as "pickupLocation",
        ST_AsText("dropoffLocation") as "dropoffLocation",
        status, 
        "createdAt"
    `;

    const newRide = result[0];

    await rideRequestsQueue.add(
      'new-ride',
      {
        tripId: newRide.id,
        riderId: rider.id,
        pickupLng: pickupLocation[0],
        pickupLat: pickupLocation[1],
        dropoffLng: dropoffLocation[0],
        dropoffLat: dropoffLocation[1],
      },
      { jobId: newRide.id },
    );

    logger.info({ tripId: newRide.id }, 'Ride job published to ride-requests queue');

    return {
      success: true,
      message: 'Ride created successfully',
      data: newRide as unknown as Record<string, unknown>,
    };
  } catch (error) {
    logger.error(error, 'Error creating ride');
    throw new Error('Could not create ride. Please try again.');
  }
};

// ─── ACCEPT RIDE ──────────────────────────────────────────────────────────

export const acceptRide = async (
  userId: string,
  tripId: string,
  offerId: string,
): Promise<RideResponse> => {
  try {
    // 1. Find driver record
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) return { success: false, message: 'Driver not found' };

    // 2. Validate offer exists and belongs to this driver
    const offer = await prisma.rideOffer.findUnique({ where: { id: offerId } });
    if (!offer) return { success: false, message: 'Offer not found' };
    if (offer.driverId !== driver.id) return { success: false, message: 'Offer not assigned to you' };
    if (offer.status !== 'PENDING') return { success: false, message: 'Offer is no longer available' };

    // 3. Race condition protection: SETNX distributed lock
    const lockKey = `${RIDE_LOCK_KEY_PREFIX}${tripId}`;
    const lockAcquired = await redis.set(lockKey, driver.id, 'EX', 300, 'NX');

    if (!lockAcquired) {
      return { success: false, message: 'Ride has already been accepted by another driver' };
    }

    // 4. Publish ride-lifecycle ACCEPT job
    await rideLifecycleQueue.add(
      'lifecycle-accept',
      {
        action: 'ACCEPT' as const,
        tripId,
        driverId: driver.id,
        offerId,
      },
      { jobId: `accept:${tripId}` },
    );

    logger.info({ tripId, driverId: driver.id, offerId }, 'Ride accept job published');

    return { success: true, message: 'Ride accepted — processing' };
  } catch (error) {
    logger.error(error, 'Error accepting ride');
    throw new Error('Could not accept ride. Please try again.');
  }
};

// ─── REJECT RIDE ──────────────────────────────────────────────────────────

export const rejectRide = async (
  userId: string,
  tripId: string,
  offerId: string,
): Promise<RideResponse> => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) return { success: false, message: 'Driver not found' };

    const offer = await prisma.rideOffer.findUnique({ where: { id: offerId } });
    if (!offer) return { success: false, message: 'Offer not found' };
    if (offer.driverId !== driver.id) return { success: false, message: 'Offer not assigned to you' };

    // Mark offer as REJECTED
    await prisma.rideOffer.update({
      where: { id: offerId },
      data: { status: 'REJECTED' },
    });

    // Get the trip to fetch coords for cascade
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return { success: false, message: 'Trip not found' };

    // Parse pickup/dropoff coordinates from geometry
    const pickupCoords = await prisma.$queryRaw<{ lng: number; lat: number }[]>`
      SELECT ST_X("pickupLocation") as lng, ST_Y("pickupLocation") as lat
      FROM "Trip" WHERE id = ${tripId}
    `;
    const dropoffCoords = await prisma.$queryRaw<{ lng: number; lat: number }[]>`
      SELECT ST_X("dropoffLocation") as lng, ST_Y("dropoffLocation") as lat
      FROM "Trip" WHERE id = ${tripId}
    `;

    // Trigger immediate cascade to next driver (no delay)
    await rideMatchingQueue.add(
      'cascade-reject',
      {
        tripId,
        riderId: trip.riderId,
        pickupLng: pickupCoords[0]?.lng ?? 0,
        pickupLat: pickupCoords[0]?.lat ?? 0,
        dropoffLng: dropoffCoords[0]?.lng ?? 0,
        dropoffLat: dropoffCoords[0]?.lat ?? 0,
        attempt: 1,
        skippedDriverIds: [userId],
      },
      { jobId: `reject-cascade:${tripId}:${offerId}` },
    );

    logger.info({ tripId, offerId, driverId: driver.id }, 'Offer rejected — cascading');

    return { success: true, message: 'Ride rejected' };
  } catch (error) {
    logger.error(error, 'Error rejecting ride');
    throw new Error('Could not reject ride. Please try again.');
  }
};

// ─── VERIFY OTP ───────────────────────────────────────────────────────────

export const verifyOtp = async (
  userId: string,
  tripId: string,
  otp: string,
): Promise<RideResponse> => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) return { success: false, message: 'Driver not found' };

    // Validate driver is assigned to this trip
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return { success: false, message: 'Trip not found' };
    if (trip.driverId !== driver.id) return { success: false, message: 'You are not assigned to this ride' };
    if (trip.status !== 'ACCEPTED') return { success: false, message: 'Ride is not in ACCEPTED state' };

    // Publish ride-lifecycle VERIFY_OTP job
    await rideLifecycleQueue.add(
      'lifecycle-verify-otp',
      {
        action: 'VERIFY_OTP' as const,
        tripId,
        driverId: driver.id,
        otp,
      },
      { jobId: `verify-otp:${tripId}:${Date.now()}` },
    );

    return { success: true, message: 'OTP verification submitted' };
  } catch (error) {
    logger.error(error, 'Error verifying OTP');
    throw new Error('Could not verify OTP. Please try again.');
  }
};

// ─── CANCEL RIDE (enhanced with tripId) ──────────────────────────────────

export const cancelRide = async (userId: string, tripId?: string): Promise<RideResponse> => {
  try {
    const rider = await prisma.rider.findUnique({
      where: { userId },
    });

    let ride;

    if (tripId) {
      // Cancel specific trip
      ride = await prisma.trip.findFirst({
        where: {
          id: tripId,
          riderId: rider?.id,
          status: { in: ['REQUESTED', 'ACCEPTED'] },
        },
      });
    } else {
      // Legacy: cancel most recent active ride
      ride = await prisma.trip.findFirst({
        where: {
          riderId: rider?.id,
          status: { in: ['REQUESTED', 'ACCEPTED'] },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (!ride) {
      return { success: false, message: 'No active ride found to cancel' };
    }

    // Publish cancel to lifecycle queue for proper cleanup
    await rideLifecycleQueue.add(
      'lifecycle-cancel',
      {
        action: 'CANCEL' as const,
        tripId: ride.id,
        riderId: rider?.id,
        reason: 'rider cancelled',
      },
      { jobId: `cancel:${ride.id}` },
    );

    return { success: true, message: 'Ride cancellation submitted' };
  } catch (error) {
    logger.error(error, 'Error cancelling ride');
    throw new Error('Could not cancel ride. Please try again.');
  }
};

// ─── DRIVER CANCEL ───────────────────────────────────────────────────────

export const driverCancelRide = async (userId: string, tripId: string): Promise<RideResponse> => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) return { success: false, message: 'Driver not found' };

    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return { success: false, message: 'Trip not found' };
    if (trip.driverId !== driver.id) return { success: false, message: 'You are not assigned to this ride' };
    if (trip.status !== 'ACCEPTED') return { success: false, message: 'Can only cancel an ACCEPTED ride' };

    await rideLifecycleQueue.add(
      'lifecycle-cancel',
      {
        action: 'CANCEL' as const,
        tripId,
        driverId: driver.id,
        reason: 'driver cancelled',
      },
      { jobId: `driver-cancel:${tripId}` },
    );

    return { success: true, message: 'Ride cancellation submitted' };
  } catch (error) {
    logger.error(error, 'Error cancelling ride');
    throw new Error('Could not cancel ride. Please try again.');
  }
};

// ─── COMPLETE RIDE ────────────────────────────────────────────────────────

export const completeRide = async (userId: string, tripId: string): Promise<RideResponse> => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId } });
    if (!driver) return { success: false, message: 'Driver not found' };

    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) return { success: false, message: 'Trip not found' };
    if (trip.driverId !== driver.id) return { success: false, message: 'You are not assigned to this ride' };
    if (trip.status !== 'STARTED') return { success: false, message: 'Ride is not in STARTED state' };

    await rideLifecycleQueue.add(
      'lifecycle-complete',
      {
        action: 'COMPLETE' as const,
        tripId,
        driverId: driver.id,
      },
      { jobId: `complete:${tripId}` },
    );

    return { success: true, message: 'Ride completion submitted' };
  } catch (error) {
    logger.error(error, 'Error completing ride');
    throw new Error('Could not complete ride. Please try again.');
  }
};

// ─── RIDE HISTORY ─────────────────────────────────────────────────────────

export const getRideHistory = async (
  userId: string,
  role: string,
  page: number,
  limit: number,
): Promise<RideResponse> => {
  try {
    let whereClause = '';
    let countClause = '';

    if (role === 'rider') {
      const rider = await prisma.rider.findUnique({ where: { userId }, select: { id: true } });
      if (!rider) return { success: false, message: 'Rider not found' };
      whereClause = `WHERE t."riderId" = '${rider.id}'`;
      countClause = whereClause;
    } else {
      const driver = await prisma.driver.findUnique({ where: { userId }, select: { id: true } });
      if (!driver) return { success: false, message: 'Driver not found' };
      whereClause = `WHERE t."driverId" = '${driver.id}'`;
      countClause = whereClause;
    }

    const offset = (page - 1) * limit;

    const rides = await prisma.$queryRawUnsafe<Record<string, unknown>[]>(`
      SELECT
        t.id,
        t.status,
        ST_AsText(t."pickupLocation") as "pickupLocation",
        ST_AsText(t."dropoffLocation") as "dropoffLocation",
        t.fare,
        t.distance,
        t."createdAt",
        t."completedAt"
      FROM "Trip" t
      ${whereClause}
      ORDER BY t."createdAt" DESC
      LIMIT ${limit} OFFSET ${offset}
    `);

    const countResult = await prisma.$queryRawUnsafe<{ count: bigint }[]>(`
      SELECT COUNT(*) as count FROM "Trip" t ${countClause}
    `);
    const total = Number(countResult[0]?.count ?? 0);

    return {
      success: true,
      message: 'Ride history retrieved',
      data: {
        rides,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      },
    };
  } catch (error) {
    logger.error(error, 'Error fetching ride history');
    throw new Error('Could not fetch ride history.');
  }
};

// ─── RIDE DETAIL ──────────────────────────────────────────────────────────

export const getRideDetail = async (userId: string, tripId: string): Promise<RideResponse> => {
  try {
    // Check access: must be the rider or assigned driver
    const rider = await prisma.rider.findUnique({ where: { userId }, select: { id: true } });
    const driver = await prisma.driver.findUnique({ where: { userId }, select: { id: true } });

    const trip = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        t.id,
        t."riderId",
        t."driverId",
        t.status,
        t.otp,
        t.fare,
        t.distance,
        ST_AsText(t."pickupLocation") as "pickupLocation",
        ST_AsText(t."dropoffLocation") as "dropoffLocation",
        t."createdAt",
        t."completedAt"
      FROM "Trip" t WHERE t.id = ${tripId}
    `;

    if (!trip.length) return { success: false, message: 'Trip not found' };

    const tripData = trip[0];
    const isRider = rider && tripData.riderId === rider.id;
    const isDriver = driver && tripData.driverId === driver.id;

    if (!isRider && !isDriver) {
      return { success: false, message: 'You do not have access to this ride' };
    }

    return {
      success: true,
      message: 'Ride detail retrieved',
      data: tripData,
    };
  } catch (error) {
    logger.error(error, 'Error fetching ride detail');
    throw new Error('Could not fetch ride detail.');
  }
};

// ─── DRIVER STATS ─────────────────────────────────────────────────────────

export const getDriverStats = async (userId: string): Promise<RideResponse> => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId }, select: { id: true } });
    if (!driver) return { success: false, message: 'Driver not found' };

    const stats = await prisma.trip.aggregate({
      where: { driverId: driver.id, status: 'COMPLETED' },
      _count: { id: true },
      _sum: { fare: true, distance: true },
    });

    return {
      success: true,
      message: 'Driver stats retrieved',
      data: {
        totalRides: stats._count.id,
        totalEarnings: stats._sum.fare ?? 0,
        totalDistance: stats._sum.distance ?? 0,
      },
    };
  } catch (error) {
    logger.error(error, 'Error fetching driver stats');
    throw new Error('Could not fetch driver stats.');
  }
};

// ─── DRIVER CURRENT RIDE ─────────────────────────────────────────────────

export const getDriverCurrentRide = async (userId: string): Promise<RideResponse> => {
  try {
    const driver = await prisma.driver.findUnique({ where: { userId }, select: { id: true } });
    if (!driver) return { success: false, message: 'Driver not found' };

    const trip = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        t.id,
        t."riderId",
        t.status,
        t.otp,
        ST_AsText(t."pickupLocation") as "pickupLocation",
        ST_AsText(t."dropoffLocation") as "dropoffLocation",
        t."createdAt",
        r."userId" as "riderUserId"
      FROM "Trip" t
      JOIN "Rider" r ON r.id = t."riderId"
      WHERE t."driverId" = ${driver.id}
        AND t.status IN ('ACCEPTED', 'STARTED')
      ORDER BY t."createdAt" DESC
      LIMIT 1
    `;

    if (!trip.length) {
      return { success: true, message: 'No active ride', data: { ride: null } };
    }

    // Get rider basic info
    const riderUser = await prisma.user.findUnique({
      where: { id: trip[0].riderUserId as string },
      select: { name: true, number: true },
    });

    return {
      success: true,
      message: 'Current ride retrieved',
      data: { ride: { ...trip[0], riderName: riderUser?.name, riderPhone: riderUser?.number } },
    };
  } catch (error) {
    logger.error(error, 'Error fetching driver current ride');
    throw new Error('Could not fetch current ride.');
  }
};

// ─── RIDER CURRENT RIDE ──────────────────────────────────────────────────

export const getRiderCurrentRide = async (userId: string): Promise<RideResponse> => {
  try {
    const rider = await prisma.rider.findUnique({ where: { userId }, select: { id: true } });
    if (!rider) return { success: false, message: 'Rider not found' };

    const trip = await prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT
        t.id,
        t."driverId",
        t.status,
        t.otp,
        ST_AsText(t."pickupLocation") as "pickupLocation",
        ST_AsText(t."dropoffLocation") as "dropoffLocation",
        t."createdAt"
      FROM "Trip" t
      WHERE t."riderId" = ${rider.id}
        AND t.status IN ('REQUESTED', 'ACCEPTED', 'STARTED')
      ORDER BY t."createdAt" DESC
      LIMIT 1
    `;

    if (!trip.length) {
      return { success: true, message: 'No active ride', data: { ride: null } };
    }

    const tripData = trip[0] as Record<string, unknown>;

    // If driver is assigned, get their info + location
    if (tripData.driverId) {
      const driverRecord = await prisma.driver.findUnique({
        where: { id: tripData.driverId as string },
        select: { userId: true },
      });
      if (driverRecord) {
        const driverUser = await prisma.user.findUnique({
          where: { id: driverRecord.userId },
          select: { name: true, number: true },
        });
        tripData.driverName = driverUser?.name;
        tripData.driverPhone = driverUser?.number;

        // If STARTED, include driver's current location from Redis GEO
        if (tripData.status === 'STARTED') {
          try {
            const pos = await redis.geopos('drivers:active', driverRecord.userId);
            if (pos && pos[0]) {
              tripData.driverLocation = {
                lng: parseFloat(pos[0][0] as string),
                lat: parseFloat(pos[0][1] as string),
              };
            }
          } catch {
            // Redis GEO might not have position — that's ok
          }
        }
      }
    }

    return {
      success: true,
      message: 'Current ride retrieved',
      data: { ride: tripData },
    };
  } catch (error) {
    logger.error(error, 'Error fetching rider current ride');
    throw new Error('Could not fetch current ride.');
  }
};
