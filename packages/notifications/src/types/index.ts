/**
 * Core interfaces for the notification abstraction layer.
 * Channels implement NotificationChannel; the service orchestrates them.
 */

export interface NotificationChannel {
    /** Send an event to a specific user's personal room. */
    send(userId: string, event: string, payload: unknown): Promise<void>;
    /** Broadcast an event to an entire room (e.g. `ride:{tripId}`). */
    sendToRoom(room: string, event: string, payload: unknown): Promise<void>;
}

export interface NotificationOptions {
    /** Optional TTL for the notification (channel-dependent). */
    ttl?: number;
}
