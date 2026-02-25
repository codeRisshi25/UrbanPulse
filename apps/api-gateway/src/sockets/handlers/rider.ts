import type { Socket } from 'socket.io';
import prisma from '../../utils/db.js';
import type { JwtPayload } from '../../utils/jwt.js';
import logger from '../../logger.js';

/**
 * Register rider-specific socket event handlers.
 * Auto-joins the rider's personal room `rider:{riderId}`.
 *
 * Events:
 *   rider:subscribe-driver-location   { tripId }  → join `ride:{tripId}` room (validates ownership)
 *   rider:unsubscribe-driver-location { tripId }  → leave `ride:{tripId}` room
 */
export const registerRiderHandlers = (socket: Socket): void => {
    const user = socket.data.user as JwtPayload;

    // Auto-join personal rider room for targeted notifications
    void socket.join(`rider:${user.userId}`);
    logger.info({ socketId: socket.id, userId: user.userId }, 'Rider joined personal room');

    socket.on('rider:subscribe-driver-location', async (data: { tripId: string }) => {
        try {
            // Validate that this rider owns the trip
            const rider = await prisma.rider.findUnique({ where: { userId: user.userId } });
            if (!rider) {
                socket.emit('error', { message: 'Rider profile not found' });
                return;
            }

            const trip = await prisma.trip.findFirst({
                where: { id: data.tripId, riderId: rider.id },
            });

            if (!trip) {
                socket.emit('error', { message: 'Trip not found or access denied' });
                return;
            }

            await socket.join(`ride:${data.tripId}`);
            socket.emit('rider:subscribe-driver-location:ack', { tripId: data.tripId, joined: true });
            logger.info({ socketId: socket.id, userId: user.userId, tripId: data.tripId }, 'Rider subscribed to ride room');
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling rider:subscribe-driver-location');
            socket.emit('error', { message: 'Failed to subscribe to driver location' });
        }
    });

    socket.on('rider:unsubscribe-driver-location', async (data: { tripId: string }) => {
        try {
            await socket.leave(`ride:${data.tripId}`);
            socket.emit('rider:unsubscribe-driver-location:ack', { tripId: data.tripId, left: true });
            logger.info({ socketId: socket.id, userId: user.userId, tripId: data.tripId }, 'Rider unsubscribed from ride room');
        } catch (err) {
            logger.error({ err, userId: user.userId }, 'Error handling rider:unsubscribe-driver-location');
        }
    });
};
