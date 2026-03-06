import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// -- Hoisted mocks --
const setDriverOnlineMock = vi.hoisted(() => vi.fn());
const setDriverOfflineMock = vi.hoisted(() => vi.fn());
const updateDriverLocationMock = vi.hoisted(() => vi.fn());
const acceptRideMock = vi.hoisted(() => vi.fn());
const rejectRideMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/driver.service.js', () => ({
    setDriverOnline: setDriverOnlineMock,
    setDriverOffline: setDriverOfflineMock,
    updateDriverLocation: updateDriverLocationMock,
}));
vi.mock('../../services/ride.service.js', () => ({
    acceptRide: acceptRideMock,
    rejectRide: rejectRideMock,
}));
vi.mock('../../logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerDriverHandlers } from '../handlers/driver.js';

const makeSocket = (userId: string): Socket & { _trigger: (e: string, ...a: unknown[]) => Promise<void> } => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    return {
        id: 'socket-driver',
        data: { user: { userId, role: 'driver' } },
        join: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn(),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            listeners[event] = handler;
        }),
        _trigger: async (event: string, ...args: unknown[]) => { await listeners[event]?.(...args); },
    } as unknown as Socket & { _trigger: (e: string, ...a: unknown[]) => Promise<void> };
};

describe('registerDriverHandlers', () => {
    beforeEach(() => vi.clearAllMocks());

    it('auto-joins the driver personal room on connect', () => {
        const socket = makeSocket('user-driver-1');
        registerDriverHandlers(socket);
        expect(socket.join).toHaveBeenCalledWith('driver:user-driver-1');
    });

    it('driver:go-online calls setDriverOnline and emits ack', async () => {
        setDriverOnlineMock.mockResolvedValue({ success: true, message: 'Driver is now online' });
        const socket = makeSocket('user-driver-1');
        registerDriverHandlers(socket);
        await socket._trigger('driver:go-online', { lng: 77.5, lat: 12.9 });
        expect(setDriverOnlineMock).toHaveBeenCalledWith('user-driver-1', [77.5, 12.9]);
        expect(socket.emit).toHaveBeenCalledWith('driver:go-online:ack', { success: true, message: 'Driver is now online' });
    });

    it('driver:go-offline calls setDriverOffline and emits ack', async () => {
        setDriverOfflineMock.mockResolvedValue({ success: true, message: 'Driver is now offline' });
        const socket = makeSocket('user-driver-1');
        registerDriverHandlers(socket);
        await socket._trigger('driver:go-offline');
        expect(setDriverOfflineMock).toHaveBeenCalledWith('user-driver-1');
    });

    it('driver:location-update calls updateDriverLocation', async () => {
        updateDriverLocationMock.mockResolvedValue(undefined);
        const socket = makeSocket('user-driver-1');
        registerDriverHandlers(socket);
        await socket._trigger('driver:location-update', { lng: 77.6, lat: 12.8 });
        expect(updateDriverLocationMock).toHaveBeenCalledWith('user-driver-1', [77.6, 12.8]);
    });

    it('driver:accept-ride calls acceptRide and emits ack', async () => {
        acceptRideMock.mockResolvedValue({ success: true, message: 'Ride accepted — processing' });
        const socket = makeSocket('user-driver-1');
        registerDriverHandlers(socket);
        await socket._trigger('driver:accept-ride', { tripId: 'trip-1', offerId: 'offer-1' });
        expect(acceptRideMock).toHaveBeenCalledWith('user-driver-1', 'trip-1', 'offer-1');
        expect(socket.emit).toHaveBeenCalledWith('driver:accept-ride:ack', { success: true, message: 'Ride accepted — processing' });
        expect(socket.join).toHaveBeenCalledWith('ride:trip-1');
    });

    it('driver:accept-ride does NOT join ride room on failure', async () => {
        acceptRideMock.mockResolvedValue({ success: false, message: 'Already accepted' });
        const socket = makeSocket('user-driver-1');
        registerDriverHandlers(socket);
        await socket._trigger('driver:accept-ride', { tripId: 'trip-1', offerId: 'offer-1' });
        expect(socket.join).not.toHaveBeenCalledWith('ride:trip-1');
    });

    it('driver:reject-ride calls rejectRide and emits ack', async () => {
        rejectRideMock.mockResolvedValue({ success: true, message: 'Ride rejected' });
        const socket = makeSocket('user-driver-1');
        registerDriverHandlers(socket);
        await socket._trigger('driver:reject-ride', { tripId: 'trip-1', offerId: 'offer-1' });
        expect(rejectRideMock).toHaveBeenCalledWith('user-driver-1', 'trip-1', 'offer-1');
        expect(socket.emit).toHaveBeenCalledWith('driver:reject-ride:ack', { success: true, message: 'Ride rejected' });
    });
});
