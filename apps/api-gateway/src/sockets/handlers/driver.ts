import type { Socket } from 'socket.io';
import { setDriverOnline, setDriverOffline, updateDriverLocation } from '../../services/driver.service.js';
import { acceptRide, rejectRide } from '../../services/ride.service.js';
import type { JwtPayload } from '../../utils/jwt.js';
import redis from '../../utils/redis.js';
import prisma from '../../utils/db.js';
import logger from '../../logger.js';
import {
    LOCATION_THROTTLE_SECONDS,
    LOCATION_THROTTLE_KEY_PREFIX,
    CITY_AVG_SPEED_KMH,
    DRIVERS_GEO_KEY,
} from 'common';

/**
 * Register driver-specific socket event handlers.
 * Auto-joins the driver's personal room `driver:{driverId}`.
 *
 * Events:
 *   driver:go-online       { lng, lat }                → set online in DB + Redis GEO
 *   driver:go-offline      {}                          → set offline in DB + remove from Redis GEO
 *   driver:location-update { lng, lat }                → throttled update + broadcast to ride room
 *   driver:accept-ride     { tripId, offerId }         → accept ride offer (SETNX lock)
 *   driver:reject-ride     { tripId, offerId }         → reject ride offer → cascade
 */
export const registerDriverHandlers = (socket: Socket): void => {
    const user = socket.data.user as JwtPayload;

    // Auto-join personal driver room for targeted notifications
    void socket.join(`driver:${user.userId}`);
    logger.info({ socketId: socket.id, userId: user.userId }, 'Driver joined personal room');

    socket.on('driver:go-online', async (data: { lng: number; lat: number }) => {
        try {
            const result = await setDriverOnline(user.userId, [data.lng, data.lat]);
            socket.emit('driver:go-online:ack', result);
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling driver:go-online');
            socket.emit('error', { message: 'Failed to go online' });
        }
    });

    socket.on('driver:go-offline', async () => {
        try {
            const result = await setDriverOffline(user.userId);
            socket.emit('driver:go-offline:ack', result);
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling driver:go-offline');
            socket.emit('error', { message: 'Failed to go offline' });
        }
    });

    socket.on('driver:location-update', async (data: { lng: number; lat: number; heading?: number; speed?: number }) => {
        try {
            // 1. Always update Redis GEO position
            await updateDriverLocation(user.userId, [data.lng, data.lat]);

            // 2. Throttle broadcast: SETNX with 3s TTL → drop if key exists
            const throttleKey = `${LOCATION_THROTTLE_KEY_PREFIX}${user.userId}`;
            const allowed = await redis.set(throttleKey, '1', 'EX', LOCATION_THROTTLE_SECONDS, 'NX');
            if (!allowed) return; // Throttled — skip broadcast

            // 3. Find driver's active STARTED trip
            const driver = await prisma.driver.findUnique({ where: { userId: user.userId }, select: { id: true } });
            if (!driver) return;

            const activeTrip = await prisma.trip.findFirst({
                where: { driverId: driver.id, status: 'STARTED' },
                select: { id: true },
            });
            if (!activeTrip) return; // No active ride — no broadcast needed

            // 4. Calculate remaining distance: ST_DistanceSphere(current, dropoff)
            let remainingDistanceKm = 0;
            let etaMinutes = 0;
            try {
                const distResult = await prisma.$queryRaw<{ distance_meters: number }[]>`
          SELECT ST_DistanceSphere(
            ST_SetSRID(ST_MakePoint(${data.lng}, ${data.lat}), 4326)::geometry,
            "dropoffLocation"::geometry
          ) as distance_meters
          FROM "Trip" WHERE id = ${activeTrip.id}
        `;
                const meters = distResult[0]?.distance_meters ?? 0;
                remainingDistanceKm = Math.round((meters / 1000) * 100) / 100;
                etaMinutes = Math.round((remainingDistanceKm / CITY_AVG_SPEED_KMH) * 60 * 10) / 10;
            } catch {
                // PostGIS query might fail — still broadcast location without ETA
            }

            // 5. Broadcast to ride:{tripId} room
            socket.to(`ride:${activeTrip.id}`).emit('ride:driver-location', {
                lng: data.lng,
                lat: data.lat,
                heading: data.heading,
                speed: data.speed,
                remainingDistanceKm,
                etaMinutes,
                timestamp: new Date().toISOString(),
            });
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling driver:location-update');
        }
    });

    socket.on('driver:accept-ride', async (data: { tripId: string; offerId: string }) => {
        try {
            const result = await acceptRide(user.userId, data.tripId, data.offerId);
            socket.emit('driver:accept-ride:ack', result);
            if (result.success) {
                void socket.join(`ride:${data.tripId}`);
            }
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling driver:accept-ride');
            socket.emit('error', { message: 'Failed to accept ride' });
        }
    });

    socket.on('driver:reject-ride', async (data: { tripId: string; offerId: string }) => {
        try {
            const result = await rejectRide(user.userId, data.tripId, data.offerId);
            socket.emit('driver:reject-ride:ack', result);
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling driver:reject-ride');
            socket.emit('error', { message: 'Failed to reject ride' });
        }
    });
};
