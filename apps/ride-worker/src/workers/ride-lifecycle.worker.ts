import { Worker, Job, Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import redis from '../utils/redis.js';
import logger from '../logger.js';
import { QUEUE_NAMES, REDIS_CONFIG } from '../config.js';
import { validateTransition } from '../state-machine.js';
import {
  DRIVERS_BUSY_KEY,
  OTP_KEY_PREFIX,
  OTP_ATTEMPTS_KEY_PREFIX,
  OTP_TTL_SECONDS,
  MAX_OTP_ATTEMPTS,
  RIDE_LOCK_KEY_PREFIX,
  BASE_FARE,
  PER_KM_RATE,
  MIN_FARE,
} from 'common';

const prisma = new PrismaClient();

export type RideLifecycleAction = 'ACCEPT' | 'VERIFY_OTP' | 'START' | 'COMPLETE' | 'CANCEL';

export interface RideLifecycleJobData {
  action: RideLifecycleAction;
  tripId: string;
  driverId?: string;
  riderId?: string;
  offerId?: string;
  otp?: string;
  reason?: string;
}

/**
 * Generate a 4-digit numeric OTP.
 */
const generateOtp = (): string =>
  Math.floor(1000 + Math.random() * 9000).toString();

/**
 * Emit a Socket.io event via Redis pub/sub (cross-process).
 */
const emitToRoom = async (
  room: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> => {
  await redis.publish(
    'socket.io#/#',
    JSON.stringify({
      type: 2,
      data: [event, payload],
      nsp: '/',
      rooms: [room],
    }),
  );
};

// ─── ACCEPT ───────────────────────────────────────────────────────────────

const handleAccept = async (data: RideLifecycleJobData): Promise<void> => {
  const { tripId, driverId, offerId } = data;
  if (!driverId || !offerId) throw new Error('ACCEPT requires driverId and offerId');

  // 1. Get current trip status & validate transition
  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error(`Trip ${tripId} not found`);
  validateTransition(trip.status, 'ACCEPTED');

  // 2. Mark offer as ACCEPTED
  await prisma.rideOffer.update({
    where: { id: offerId },
    data: { status: 'ACCEPTED' },
  });

  // 3. Mark all other PENDING offers for this trip as EXPIRED
  await prisma.rideOffer.updateMany({
    where: { tripId, id: { not: offerId }, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });

  // 4. Cancel any pending timeout jobs for this trip
  const matchingQueue = new Queue(QUEUE_NAMES.RIDE_MATCHING, { connection: REDIS_CONFIG });
  try {
    // Remove delayed timeout jobs by pattern
    const delayed = await matchingQueue.getDelayed();
    for (const job of delayed) {
      if (job.data.tripId === tripId && job.name === 'offer-timeout') {
        await job.remove();
      }
    }
  } finally {
    await matchingQueue.close();
  }

  // 5. Update Trip: set driverId, status → ACCEPTED
  await prisma.trip.update({
    where: { id: tripId },
    data: { driverId, status: 'ACCEPTED' },
  });

  // 6. Add driver to busy set
  const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
  if (driver) {
    await redis.sadd(DRIVERS_BUSY_KEY, driver.userId);
  }

  // 7. Generate OTP
  const otp = generateOtp();

  // 8. Store OTP in Redis with TTL
  await redis.set(`${OTP_KEY_PREFIX}${tripId}`, otp, 'EX', OTP_TTL_SECONDS);

  // 9. Save OTP to Trip record (audit trail)
  await prisma.trip.update({
    where: { id: tripId },
    data: { otp },
  });

  // 10. Get rider userId for notification
  const rider = await prisma.rider.findUnique({ where: { id: trip.riderId }, select: { userId: true } });

  // 11. Notify rider via ride:accepted (includes driver info but NOT OTP)
  if (rider) {
    await emitToRoom(`rider:${rider.userId}`, 'ride:accepted', {
      tripId,
      driverId,
    });

    // 12. Notify rider via ride:otp separately
    await emitToRoom(`rider:${rider.userId}`, 'ride:otp', {
      tripId,
      otp,
    });
  }

  logger.info({ tripId, driverId, offerId, otp }, 'Ride ACCEPTED — OTP generated and sent');
};

// ─── VERIFY_OTP ───────────────────────────────────────────────────────────

const handleVerifyOtp = async (data: RideLifecycleJobData): Promise<void> => {
  const { tripId, otp, driverId } = data;
  if (!otp) throw new Error('VERIFY_OTP requires otp');

  // 1. Get stored OTP from Redis
  const storedOtp = await redis.get(`${OTP_KEY_PREFIX}${tripId}`);
  if (!storedOtp) throw new Error(`OTP for trip ${tripId} not found or expired`);

  // 2. Track attempts
  const attemptsKey = `${OTP_ATTEMPTS_KEY_PREFIX}${tripId}`;
  const attempts = await redis.incr(attemptsKey);
  await redis.expire(attemptsKey, OTP_TTL_SECONDS);

  // 3. On match: transition to STARTED
  if (otp === storedOtp) {
    // Validate state transition
    const trip = await prisma.trip.findUnique({ where: { id: tripId } });
    if (!trip) throw new Error(`Trip ${tripId} not found`);
    validateTransition(trip.status, 'STARTED');

    // Update Trip status → STARTED
    await prisma.trip.update({
      where: { id: tripId },
      data: { status: 'STARTED' },
    });

    // Delete OTP from Redis
    await redis.del(`${OTP_KEY_PREFIX}${tripId}`);
    await redis.del(attemptsKey);

    // Notify ride room
    await emitToRoom(`ride:${tripId}`, 'ride:started', { tripId });

    logger.info({ tripId }, 'OTP verified — ride STARTED');
    return;
  }

  // 4. On mismatch
  const remaining = MAX_OTP_ATTEMPTS - attempts;

  if (remaining <= 0) {
    // Max attempts exceeded: cancel ride
    logger.warn({ tripId, attempts }, 'Max OTP attempts exceeded — cancelling ride');
    await handleCancel({
      action: 'CANCEL',
      tripId,
      driverId,
      reason: 'max OTP attempts exceeded',
    });
    return;
  }

  // Notify driver of wrong OTP via their personal room
  if (driverId) {
    const driver = await prisma.driver.findUnique({ where: { id: driverId }, select: { userId: true } });
    if (driver) {
      await emitToRoom(`driver:${driver.userId}`, 'ride:otp-error', {
        tripId,
        message: `Incorrect OTP. ${remaining} attempt(s) remaining.`,
        remainingAttempts: remaining,
      });
    }
  }

  logger.info({ tripId, attempts, remaining }, 'OTP mismatch');
};

// ─── CANCEL ───────────────────────────────────────────────────────────────

const handleCancel = async (data: RideLifecycleJobData): Promise<void> => {
  const { tripId, reason } = data;

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  // Validate transition
  validateTransition(trip.status, 'CANCELLED');

  // Update Trip status → CANCELLED
  await prisma.trip.update({
    where: { id: tripId },
    data: { status: 'CANCELLED' },
  });

  // If was ACCEPTED (has a driver assigned): remove from busy set
  if (trip.driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: trip.driverId },
      select: { userId: true },
    });
    if (driver) {
      await redis.srem(DRIVERS_BUSY_KEY, driver.userId);
    }
  }

  // Clean up Redis keys
  await redis.del(`${OTP_KEY_PREFIX}${tripId}`);
  await redis.del(`${OTP_ATTEMPTS_KEY_PREFIX}${tripId}`);
  await redis.del(`${RIDE_LOCK_KEY_PREFIX}${tripId}`);

  // Mark any PENDING offers as EXPIRED
  await prisma.rideOffer.updateMany({
    where: { tripId, status: 'PENDING' },
    data: { status: 'EXPIRED' },
  });

  // Notify ride room
  await emitToRoom(`ride:${tripId}`, 'ride:cancelled', {
    tripId,
    reason: reason ?? 'cancelled',
  });

  // Also notify rider personal room
  const rider = await prisma.rider.findUnique({
    where: { id: trip.riderId },
    select: { userId: true },
  });
  if (rider) {
    await emitToRoom(`rider:${rider.userId}`, 'ride:cancelled', {
      tripId,
      reason: reason ?? 'cancelled',
    });
  }

  logger.info({ tripId, reason }, 'Ride CANCELLED');
};

// ─── COMPLETE ─────────────────────────────────────────────────────────────

const handleComplete = async (data: RideLifecycleJobData): Promise<void> => {
  const { tripId, driverId } = data;

  const trip = await prisma.trip.findUnique({ where: { id: tripId } });
  if (!trip) throw new Error(`Trip ${tripId} not found`);

  // Idempotent: if already COMPLETED (e.g. BullMQ retry after partial failure),
  // skip validation + DB update but still run cleanup/notifications
  const alreadyCompleted = trip.status === 'COMPLETED';
  if (!alreadyCompleted) {
    validateTransition(trip.status, 'COMPLETED');
  }

  const completedAt = trip.completedAt ?? new Date();

  // 1. Calculate distance using PostGIS ST_DistanceSphere
  const distanceResult = await prisma.$queryRaw<{ distance_meters: number }[]>`
    SELECT ST_DistanceSphere(
      "pickupLocation"::geometry,
      "dropoffLocation"::geometry
    ) as distance_meters
    FROM "Trip" WHERE id = ${tripId}
  `;

  const distanceMeters = distanceResult[0]?.distance_meters ?? 0;
  const distanceKm = distanceMeters / 1000;

  // 2. Calculate fare: max(MIN_FARE, BASE_FARE + distance_km * PER_KM_RATE)
  const calculatedFare = BASE_FARE + distanceKm * PER_KM_RATE;
  const fare = Math.round(Math.max(MIN_FARE, calculatedFare) * 100) / 100;

  // 3. Update Trip: COMPLETED, fare, distance, completedAt (skip if already done)
  if (!alreadyCompleted) {
    await prisma.trip.update({
      where: { id: tripId },
      data: {
        status: 'COMPLETED',
        fare,
        distance: Math.round(distanceKm * 100) / 100,
        completedAt,
      },
    });
  }

  // 4. Remove driver from busy set
  if (trip.driverId) {
    const driver = await prisma.driver.findUnique({
      where: { id: trip.driverId },
      select: { userId: true },
    });
    if (driver) {
      await redis.srem(DRIVERS_BUSY_KEY, driver.userId);
    }
  }

  // 5. Clean up Redis keys
  await redis.del(`${RIDE_LOCK_KEY_PREFIX}${tripId}`);
  await redis.del(`${OTP_KEY_PREFIX}${tripId}`);
  await redis.del(`${OTP_ATTEMPTS_KEY_PREFIX}${tripId}`);

  // 6. Get pickup/dropoff as text for notification
  const locations = await prisma.$queryRaw<{ pickup: string; dropoff: string }[]>`
    SELECT ST_AsText("pickupLocation") as pickup, ST_AsText("dropoffLocation") as dropoff
    FROM "Trip" WHERE id = ${tripId}
  `;

  // 7. Notify ride room
  await emitToRoom(`ride:${tripId}`, 'ride:completed', {
    tripId,
    fare,
    distanceKm: Math.round(distanceKm * 100) / 100,
    pickupLocation: locations[0]?.pickup ?? '',
    dropoffLocation: locations[0]?.dropoff ?? '',
    completedAt: completedAt.toISOString(),
  });

  // Also notify rider personal room
  const rider = await prisma.rider.findUnique({
    where: { id: trip.riderId },
    select: { userId: true },
  });
  if (rider) {
    await emitToRoom(`rider:${rider.userId}`, 'ride:completed', {
      tripId,
      fare,
      distanceKm: Math.round(distanceKm * 100) / 100,
    });
  }

  logger.info({ tripId, fare, distanceKm, driverId }, 'Ride COMPLETED');
};

// ─── MAIN PROCESSOR ──────────────────────────────────────────────────────

const processRideLifecycle = async (job: Job<RideLifecycleJobData>) => {
  const { action, tripId } = job.data;

  logger.info({ action, tripId, jobId: job.id }, 'ride-lifecycle job received');

  switch (action) {
    case 'ACCEPT':
      await handleAccept(job.data);
      break;
    case 'VERIFY_OTP':
      await handleVerifyOtp(job.data);
      break;
    case 'START':
      // START is handled inline after VERIFY_OTP succeeds
      logger.info({ tripId }, 'START action — handled via VERIFY_OTP flow');
      break;
    case 'COMPLETE':
      await handleComplete(job.data);
      break;
    case 'CANCEL':
      await handleCancel(job.data);
      break;
    default:
      logger.warn({ action, tripId }, 'Unknown ride lifecycle action');
  }
};

export const createRideLifecycleWorker = () => {
  const worker = new Worker<RideLifecycleJobData>(
    QUEUE_NAMES.RIDE_LIFECYCLE,
    processRideLifecycle,
    {
      connection: REDIS_CONFIG,
      concurrency: 10,
    },
  );

  worker.on('completed', (job) => {
    logger.info(
      { jobId: job.id, action: job.data.action, tripId: job.data.tripId },
      'ride-lifecycle job completed',
    );
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, err }, 'ride-lifecycle job failed');
  });

  return worker;
};
