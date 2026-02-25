import type { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import type { Server as SocketServer } from 'socket.io';
import type { NotificationChannel } from '../types/index.js';

/**
 * SocketChannel — emits events via Socket.io using the Redis adapter.
 *
 * When used from ride-worker (no direct Socket.io server), it publishes
 * through Redis pub/sub. The api-gateway's Socket.io server has the adapter
 * attached and delivers messages to connected WebSocket clients.
 *
 * When used from api-gateway, `io` is the live Socket.io server.
 */
export class SocketChannel implements NotificationChannel {
    private io: SocketServer;

    constructor(io: SocketServer) {
        this.io = io;
    }

    /**
     * Emit an event to a user's personal room.
     * By convention, personal rooms are named `driver:{id}` or `rider:{id}`.
     * Callers should pass the full room name (e.g. `driver:abc123`).
     */
    async send(room: string, event: string, payload: unknown): Promise<void> {
        this.io.to(room).emit(event, payload);
    }

    /**
     * Broadcast an event to a shared room (e.g. `ride:{tripId}`).
     */
    async sendToRoom(room: string, event: string, payload: unknown): Promise<void> {
        this.io.to(room).emit(event, payload);
    }
}

/**
 * Helper to attach the Redis pub/sub adapter to a Socket.io server.
 * Call this once during api-gateway startup.
 */
export const attachRedisAdapter = (io: SocketServer, pubClient: Redis, subClient: Redis): void => {
    io.adapter(createAdapter(pubClient, subClient));
};
