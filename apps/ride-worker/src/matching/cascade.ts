import { Queue } from 'bullmq';
import { PrismaClient } from '@prisma/client';
import redis from '../utils/redis.js';
import logger from '../logger.js';
import { QUEUE_NAMES, REDIS_CONFIG } from '../config.js';
import {
    MATCHING_RADIUS_KM,
    MATCHING_EXPANDED_RADIUS_KM,
    OFFER_TIMEOUT_SECONDS,
    MAX_CASCADE_ATTEMPTS,
    DRIVERS_BUSY_KEY,
    DRIVERS_GEO_KEY,
} from 'common';

const prisma = new PrismaClient();

const rideLifecycleQueue = new Queue(QUEUE_NAMES.RIDE_LIFECYCLE, {
    connection: REDIS_CONFIG,
});

const rideMatchingQueue = new Queue(QUEUE_NAMES.RIDE_MATCHING, {
    connection: REDIS_CONFIG,
});

export interface CascadeContext {
    tripId: string;
    riderId: string;
    pickupLng: number;
    pickupLat: number;
    dropoffLng: number;
    dropoffLat: number;
    attempt: number;
    /** Driver IDs already offered to (to skip in subsequent rounds). */
    skippedDriverIds?: string[];
}

/**
 * Find nearby available drivers using Redis GEOSEARCH.
 * Returns driver member names (userId) sorted by distance ascending.
 */
export const findNearbyDrivers = async (
    lng: number,
    lat: number,
    radiusKm: number,
): Promise<string[]> => {
    // GEOSEARCH returns members within radius, sorted by distance
    const results = await redis.geosearch(
        DRIVERS_GEO_KEY,
        'FROMLONLAT',
        lng,
        lat,
        'BYRADIUS',
        radiusKm,
        'km',
        'ASC',
    );

    return results as string[];
};

/**
 * Filter out drivers that are currently busy (on an active ride).
 */
export const filterBusyDrivers = async (driverUserIds: string[]): Promise<string[]> => {
    if (driverUserIds.length === 0) return [];

    const pipeline = redis.pipeline();
    for (const id of driverUserIds) {
        pipeline.sismember(DRIVERS_BUSY_KEY, id);
    }
    const results = await pipeline.exec();

    return driverUserIds.filter((_, i) => {
        const [err, isBusy] = results![i];
        return !err && isBusy === 0;
    });
};

/**
 * Look up driver record by userId and return driverId.
 * Returns null if driver doesn't exist.
 */
const getDriverId = async (userId: string): Promise<string | null> => {
    const driver = await prisma.driver.findUnique({
        where: { userId },
        select: { id: true },
    });
    return driver?.id ?? null;
};

/**
 * Run cascade matching for a ride.
 * Finds the nearest available driver and sends them an offer.
 * If no drivers are available, expands radius once, then cancels.
 */
export const runCascadeMatching = async (ctx: CascadeContext): Promise<void> => {
    const { tripId, riderId, pickupLng, pickupLat, attempt } = ctx;
    const skippedDriverIds = ctx.skippedDriverIds ?? [];

    logger.info({ tripId, attempt, skippedCount: skippedDriverIds.length }, 'Running cascade matching');

    if (attempt > MAX_CASCADE_ATTEMPTS) {
        logger.warn({ tripId }, 'Max cascade attempts reached — cancelling ride');
        await cancelRideNoDrivers(tripId, riderId);
        return;
    }

    // Determine radius: expand after exhausting initial radius
    const radius = attempt === 1 ? MATCHING_RADIUS_KM : MATCHING_EXPANDED_RADIUS_KM;

    // 1. Find nearby drivers
    const nearbyDriverUserIds = await findNearbyDrivers(pickupLng, pickupLat, radius);
    logger.info({ tripId, nearbyCount: nearbyDriverUserIds.length, radius }, 'Nearby drivers found');

    // 2. Filter out busy drivers and already-offered drivers
    const availableDriverUserIds = (await filterBusyDrivers(nearbyDriverUserIds))
        .filter((id) => !skippedDriverIds.includes(id));

    if (availableDriverUserIds.length === 0) {
        // If we haven't tried expanded radius yet, try once
        if (radius === MATCHING_RADIUS_KM) {
            logger.info({ tripId }, 'No drivers in initial radius — expanding to fallback radius');
            await rideMatchingQueue.add(
                'cascade-expanded',
                {
                    ...ctx,
                    attempt: attempt + 1,
                    skippedDriverIds,
                },
                { jobId: `match:${tripId}:${attempt + 1}` },
            );
            return;
        }

        logger.warn({ tripId }, 'No available drivers even with expanded radius — cancelling');
        await cancelRideNoDrivers(tripId, riderId);
        return;
    }

    // 3. Pick the nearest available driver (first in sorted list)
    const targetDriverUserId = availableDriverUserIds[0];
    const driverId = await getDriverId(targetDriverUserId);

    if (!driverId) {
        logger.warn({ tripId, targetDriverUserId }, 'Driver record not found — skipping');
        await rideMatchingQueue.add(
            'cascade-skip',
            {
                ...ctx,
                attempt: attempt + 1,
                skippedDriverIds: [...skippedDriverIds, targetDriverUserId],
            },
            { jobId: `match:${tripId}:${attempt + 1}` },
        );
        return;
    }

    // 4. Create RideOffer in DB
    const expiresAt = new Date(Date.now() + OFFER_TIMEOUT_SECONDS * 1000);
    const offer = await prisma.rideOffer.create({
        data: {
            tripId,
            driverId,
            expiresAt,
        },
    });

    logger.info(
        { tripId, offerId: offer.id, driverId, targetDriverUserId, expiresAt },
        'Ride offer created — notifying driver',
    );

    // 5. Notify driver via Socket.io (ride:offer event to driver:{userId} room)
    //    The notification happens via a lifecycle-style BullMQ job that the api-gateway
    //    or a notification worker picks up. For now we emit a special matching job
    //    that the api-gateway sockets can poll. In practice the ride-worker will use
    //    the Redis pub/sub adapter to emit directly — this is wired up below.
    await emitDriverOffer(targetDriverUserId, {
        tripId,
        offerId: offer.id,
        pickupLng: ctx.pickupLng,
        pickupLat: ctx.pickupLat,
        dropoffLng: ctx.dropoffLng,
        dropoffLat: ctx.dropoffLat,
    });

    // 6. Schedule timeout check (delayed job)
    await rideMatchingQueue.add(
        'offer-timeout',
        {
            tripId,
            riderId: ctx.riderId,
            offerId: offer.id,
            pickupLng: ctx.pickupLng,
            pickupLat: ctx.pickupLat,
            dropoffLng: ctx.dropoffLng,
            dropoffLat: ctx.dropoffLat,
            attempt: attempt + 1,
            skippedDriverIds: [...skippedDriverIds, targetDriverUserId],
        },
        {
            delay: OFFER_TIMEOUT_SECONDS * 1000,
            jobId: `timeout:${tripId}:${offer.id}`,
        },
    );
};

/**
 * Handle offer timeout: check if still PENDING, mark EXPIRED, cascade.
 */
export const handleOfferTimeout = async (
    offerId: string,
    ctx: CascadeContext,
): Promise<void> => {
    const offer = await prisma.rideOffer.findUnique({ where: { id: offerId } });

    if (!offer || offer.status !== 'PENDING') {
        logger.info({ offerId, status: offer?.status }, 'Offer no longer pending — skipping timeout');
        return;
    }

    // Mark as EXPIRED
    await prisma.rideOffer.update({
        where: { id: offerId },
        data: { status: 'EXPIRED' },
    });

    // Notify driver that offer expired
    const driver = await prisma.driver.findUnique({
        where: { id: offer.driverId },
        select: { userId: true },
    });

    if (driver) {
        await emitDriverOfferExpired(driver.userId, {
            tripId: ctx.tripId,
            offerId,
        });
    }

    logger.info({ offerId, tripId: ctx.tripId }, 'Offer expired — cascading to next driver');

    // Continue cascade
    await runCascadeMatching(ctx);
};

/**
 * Emit ride:offer event to a driver via Redis pub/sub.
 * The api-gateway's Socket.io Redis adapter picks this up and delivers.
 */
const emitDriverOffer = async (
    driverUserId: string,
    payload: Record<string, unknown>,
): Promise<void> => {
    await redis.publish(
        'socket.io#/#',
        JSON.stringify({
            type: 2,
            data: ['ride:offer', payload],
            nsp: '/',
            rooms: [`driver:${driverUserId}`],
        }),
    );
};

/**
 * Emit ride:offer-expired event to a driver via Redis pub/sub.
 */
const emitDriverOfferExpired = async (
    driverUserId: string,
    payload: Record<string, unknown>,
): Promise<void> => {
    await redis.publish(
        'socket.io#/#',
        JSON.stringify({
            type: 2,
            data: ['ride:offer-expired', payload],
            nsp: '/',
            rooms: [`driver:${driverUserId}`],
        }),
    );
};

/**
 * Cancel ride when no drivers are available.
 */
const cancelRideNoDrivers = async (tripId: string, riderId: string): Promise<void> => {
    await rideLifecycleQueue.add(
        'lifecycle-cancel',
        {
            action: 'CANCEL' as const,
            tripId,
            riderId,
            reason: 'no drivers available',
        },
        { jobId: `cancel:${tripId}` },
    );
};

export { rideLifecycleQueue, rideMatchingQueue };
