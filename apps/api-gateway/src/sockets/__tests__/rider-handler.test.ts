import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// -- Hoisted mocks --
const prismaMock = vi.hoisted(() => ({
    rider: { findUnique: vi.fn() },
    trip: { findFirst: vi.fn() },
}));
vi.mock('../../utils/db.js', () => ({ default: prismaMock }));
vi.mock('../../logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerRiderHandlers } from '../handlers/rider.js';

const makeSocket = (userId: string): Socket & { _trigger: (e: string, ...a: unknown[]) => Promise<void> } => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    return {
        id: 'socket-rider',
        data: { user: { userId, role: 'rider' } },
        join: vi.fn().mockResolvedValue(undefined),
        leave: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn(),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            listeners[event] = handler;
        }),
        _trigger: async (event: string, ...args: unknown[]) => { await listeners[event]?.(...args); },
    } as unknown as Socket & { _trigger: (e: string, ...a: unknown[]) => Promise<void> };
};

describe('registerRiderHandlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('auto-joins the rider personal room on connect', () => {
        const socket = makeSocket('user-rider-1');
        registerRiderHandlers(socket);
        expect(socket.join).toHaveBeenCalledWith('rider:user-rider-1');
    });

    it('rider:subscribe-driver-location emits error if rider not found', async () => {
        prismaMock.rider.findUnique.mockResolvedValue(null);
        const socket = makeSocket('user-rider-1');
        registerRiderHandlers(socket);
        await socket._trigger('rider:subscribe-driver-location', { tripId: 'trip-1' });
        expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Rider profile not found' });
        expect(socket.join).toHaveBeenCalledTimes(1); // only the personal room
    });

    it('rider:subscribe-driver-location emits error if trip not owned by rider', async () => {
        prismaMock.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
        prismaMock.trip.findFirst.mockResolvedValue(null);
        const socket = makeSocket('user-rider-1');
        registerRiderHandlers(socket);
        await socket._trigger('rider:subscribe-driver-location', { tripId: 'trip-999' });
        expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Trip not found or access denied' });
    });

    it('rider:subscribe-driver-location joins ride room and emits ack when authorized', async () => {
        prismaMock.rider.findUnique.mockResolvedValue({ id: 'rider-1' });
        prismaMock.trip.findFirst.mockResolvedValue({ id: 'trip-1', riderId: 'rider-1' });
        const socket = makeSocket('user-rider-1');
        registerRiderHandlers(socket);
        await socket._trigger('rider:subscribe-driver-location', { tripId: 'trip-1' });
        expect(socket.join).toHaveBeenCalledWith('ride:trip-1');
        expect(socket.emit).toHaveBeenCalledWith('rider:subscribe-driver-location:ack', { tripId: 'trip-1', joined: true });
    });

    it('rider:unsubscribe-driver-location leaves room and emits ack', async () => {
        const socket = makeSocket('user-rider-1');
        registerRiderHandlers(socket);
        await socket._trigger('rider:unsubscribe-driver-location', { tripId: 'trip-1' });
        expect(socket.leave).toHaveBeenCalledWith('ride:trip-1');
        expect(socket.emit).toHaveBeenCalledWith('rider:unsubscribe-driver-location:ack', { tripId: 'trip-1', left: true });
    });
});
