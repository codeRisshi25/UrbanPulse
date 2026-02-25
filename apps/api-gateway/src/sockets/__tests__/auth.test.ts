import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// -- Mocks --
const verifyTokenMock = vi.hoisted(() => vi.fn());
vi.mock('../../utils/jwt.js', () => ({
    verifyToken: verifyTokenMock,
}));
vi.mock('../../logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { socketAuthMiddleware } from '../auth.js';

const makeSocket = (overrides: Record<string, unknown> = {}): Socket => ({
    id: 'socket-1',
    data: {},
    handshake: {
        auth: {},
        headers: {},
        ...overrides,
    },
}) as unknown as Socket;

describe('socketAuthMiddleware', () => {
    beforeEach(() => vi.clearAllMocks());

    it('rejects connection when no token is provided', () => {
        const socket = makeSocket();
        const next = vi.fn();
        socketAuthMiddleware(socket, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication token is required' }));
        expect(socket.data.user).toBeUndefined();
    });

    it('rejects connection when token is invalid', () => {
        verifyTokenMock.mockImplementation(() => { throw new Error('bad token'); });
        const socket = makeSocket({ auth: { token: 'bad-token' } });
        const next = vi.fn();
        socketAuthMiddleware(socket, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Invalid or expired token' }));
    });

    it('attaches user payload and calls next() for valid token from auth.token', () => {
        const payload = { userId: 'u1', number: '9999', role: 'driver' as const };
        verifyTokenMock.mockReturnValue(payload);
        const socket = makeSocket({ auth: { token: 'valid-token' } });
        const next = vi.fn();
        socketAuthMiddleware(socket, next);
        expect(socket.data.user).toEqual(payload);
        expect(next).toHaveBeenCalledWith(); // no error
    });

    it('attaches user payload from Authorization header (Bearer fallback)', () => {
        const payload = { userId: 'u2', number: '8888', role: 'rider' as const };
        verifyTokenMock.mockReturnValue(payload);
        const socket = makeSocket({ headers: { authorization: 'Bearer header-token' } });
        const next = vi.fn();
        socketAuthMiddleware(socket, next);
        expect(socket.data.user).toEqual(payload);
        expect(next).toHaveBeenCalledWith();
    });

    it('rejects malformed Authorization header', () => {
        const socket = makeSocket({ headers: { authorization: 'NotBearer token' } });
        const next = vi.fn();
        socketAuthMiddleware(socket, next);
        expect(next).toHaveBeenCalledWith(expect.objectContaining({ message: 'Authentication token is required' }));
    });
});
