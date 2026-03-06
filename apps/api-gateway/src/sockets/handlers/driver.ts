import type { Socket } from 'socket.io';
import { setDriverOnline, setDriverOffline, updateDriverLocation } from '../../services/driver.service.js';
import { acceptRide, rejectRide } from '../../services/ride.service.js';
import type { JwtPayload } from '../../utils/jwt.js';
import logger from '../../logger.js';

/**
 * Register driver-specific socket event handlers.
 * Auto-joins the driver's personal room `driver:{driverId}`.
 *
 * Events:
 *   driver:go-online       { lng, lat }                → set online in DB + Redis GEO
 *   driver:go-offline      {}                          → set offline in DB + remove from Redis GEO
 *   driver:location-update { lng, lat }                → update Redis GEO position
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

    socket.on('driver:location-update', async (data: { lng: number; lat: number }) => {
        try {
            await updateDriverLocation(user.userId, [data.lng, data.lat]);
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling driver:location-update');
        }
    });

    socket.on('driver:accept-ride', async (data: { tripId: string; offerId: string }) => {
        try {
            const result = await acceptRide(user.userId, data.tripId, data.offerId);
            socket.emit('driver:accept-ride:ack', result);
            if (result.success) {
                // Auto-join the ride room
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
