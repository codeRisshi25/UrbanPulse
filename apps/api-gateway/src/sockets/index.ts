import { Server as SocketServer } from 'socket.io';
import type { Server as HttpServer } from 'http';
import { Redis } from 'ioredis';
import { createAdapter } from '@socket.io/redis-adapter';
import logger from '../logger.js';
import { socketAuthMiddleware } from './auth.js';
import { registerDriverHandlers } from './handlers/driver.js';
import { registerRiderHandlers } from './handlers/rider.js';

let io: SocketServer | null = null;

/**
 * Initialize Socket.io on the provided HTTP server.
 * Must be called once during api-gateway startup, after http.createServer(app).
 */
export const initSocketServer = (httpServer: HttpServer): SocketServer => {
    const pubClient = new Redis({
        host: process.env.REDIS_HOST || 'localhost',
        port: Number(process.env.REDIS_PORT) || 6379,
    });
    const subClient = pubClient.duplicate();

    const socketServer = new SocketServer(httpServer, {
        transports: ['websocket'],
        cors: {
            origin: process.env.CORS_ORIGIN || '*',
            credentials: true,
        },
    });

    // Attach Redis adapter for horizontal scalability (cross-process pub/sub)
    socketServer.adapter(createAdapter(pubClient, subClient));

    // JWT authentication for every socket connection
    socketServer.use(socketAuthMiddleware);

    socketServer.on('connection', (socket) => {
        const { user } = socket.data as { user: { userId: string; role: string } };
        logger.info({ socketId: socket.id, userId: user.userId, role: user.role }, 'Socket connected');

        if (user.role === 'driver') {
            registerDriverHandlers(socket);
        } else if (user.role === 'rider') {
            registerRiderHandlers(socket);
        }

        socket.on('disconnect', (reason) => {
            logger.info({ socketId: socket.id, userId: user.userId, reason }, 'Socket disconnected');
        });
    });

    io = socketServer;
    logger.info('Socket.io server initialized with Redis adapter');
    return socketServer;
};

/** Get the global Socket.io server instance (throws if not initialized). */
export const getSocketServer = (): SocketServer => {
    if (!io) throw new Error('Socket.io server not initialized. Call initSocketServer() first.');
    return io;
};
