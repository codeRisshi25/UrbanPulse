import type { Socket } from 'socket.io';
import { verifyToken } from '../utils/jwt.js';
import logger from '../logger.js';

/**
 * Socket.io JWT authentication middleware.
 *
 * Extracts token from:
 *   1. socket.handshake.auth.token  (preferred — client sets during connect)
 *   2. socket.handshake.headers.authorization  (Bearer <token> fallback)
 *
 * On success: attaches JwtPayload to socket.data.user and calls next().
 * On failure: calls next(Error) which rejects the connection.
 */
export const socketAuthMiddleware = (socket: Socket, next: (err?: Error) => void): void => {
    try {
        const authToken = socket.handshake.auth?.token as string | undefined;
        const authHeader = socket.handshake.headers?.authorization;

        let rawToken: string | null = authToken ?? null;

        if (!rawToken && authHeader) {
            const parts = authHeader.split(' ');
            if (parts.length === 2 && parts[0] === 'Bearer') {
                rawToken = parts[1];
            }
        }

        if (!rawToken) {
            logger.warn({ socketId: socket.id }, 'Socket connection rejected: no token');
            return next(new Error('Authentication token is required'));
        }

        const decoded = verifyToken(rawToken);
        socket.data.user = decoded;
        next();
    } catch {
        logger.warn({ socketId: socket.id }, 'Socket connection rejected: invalid token');
        next(new Error('Invalid or expired token'));
    }
};
