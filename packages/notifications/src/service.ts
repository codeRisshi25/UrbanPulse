import type { NotificationChannel } from './types/index.js';

/**
 * NotificationService orchestrates one or more channels.
 *
 * Consumers call high-level methods like `notifyDriver()` or `notifyRide()`
 * and the service fans out to all registered channels (Socket.io, future: SMS, FCM).
 */
export class NotificationService {
    private channels: NotificationChannel[];

    constructor(channels: NotificationChannel[]) {
        this.channels = channels;
    }

    /** Emit to a user's personal room by full room name (e.g. `driver:abc123`). */
    async notifyUser(room: string, event: string, payload: unknown): Promise<void> {
        await Promise.all(this.channels.map((c) => c.send(room, event, payload)));
    }

    /** Broadcast to any room string. */
    async notifyRoom(room: string, event: string, payload: unknown): Promise<void> {
        await Promise.all(this.channels.map((c) => c.sendToRoom(room, event, payload)));
    }

    /** Emit to `driver:{driverId}` personal room. */
    async notifyDriver(driverId: string, event: string, payload: unknown): Promise<void> {
        await this.notifyRoom(`driver:${driverId}`, event, payload);
    }

    /** Emit to `rider:{riderId}` personal room. */
    async notifyRider(riderId: string, event: string, payload: unknown): Promise<void> {
        await this.notifyRoom(`rider:${riderId}`, event, payload);
    }

    /** Broadcast to `ride:{tripId}` room (both rider and assigned driver). */
    async notifyRide(tripId: string, event: string, payload: unknown): Promise<void> {
        await this.notifyRoom(`ride:${tripId}`, event, payload);
    }
}

/**
 * Factory function — preferred entry point.
 * Pass in one or more channel implementations:
 *   const svc = createNotificationService([new SocketChannel(io)]);
 */
export const createNotificationService = (channels: NotificationChannel[]): NotificationService => {
    return new NotificationService(channels);
};
