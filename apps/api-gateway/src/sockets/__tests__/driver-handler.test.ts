import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Socket } from 'socket.io';

// -- Hoisted mocks --
const setDriverOnlineMock = vi.hoisted(() => vi.fn());
const setDriverOfflineMock = vi.hoisted(() => vi.fn());
const updateDriverLocationMock = vi.hoisted(() => vi.fn());

vi.mock('../../services/driver.service.js', () => ({
    setDriverOnline: setDriverOnlineMock,
    setDriverOffline: setDriverOfflineMock,
    updateDriverLocation: updateDriverLocationMock,
}));
vi.mock('../../logger.js', () => ({
    default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { registerDriverHandlers } from '../handlers/driver.js';

const makeSocket = (userId: string): Socket => {
    const listeners: Record<string, (...args: unknown[]) => void> = {};
    return {
        id: 'socket-driver',
        data: { user: { userId, role: 'driver' } },
        join: vi.fn().mockResolvedValue(undefined),
        emit: vi.fn(),
        on: vi.fn((event: string, handler: (...args: unknown[]) => void) => {
            listeners[event] = handler;
        }),
        _trigger: (event: string, ...args: unknown[]) => listeners[event]?.(...args),
    } as unknown as Socket & { _trigger: (e: string, ...a: unknown[]) => void };
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
        const socket = makeSocket('user-driver-1') as Socket & { _trigger: (e: string, ...a: unknown[]) => void };
        registerDriverHandlers(socket);
        await (socket as unknown as { _trigger: (e: string, ...a: unknown[]) => Promise<void> })._trigger('driver:go-online', { lng: 77.5, lat: 12.9 });
        expect(setDriverOnlineMock).toHaveBeenCalledWith('user-driver-1', [77.5, 12.9]);
        expect(socket.emit).toHaveBeenCalledWith('driver:go-online:ack', { success: true, message: 'Driver is now online' });
    });

    it('driver:go-offline calls setDriverOffline and emits ack', async () => {
        setDriverOfflineMock.mockResolvedValue({ success: true, message: 'Driver is now offline' });
        const socket = makeSocket('user-driver-1') as Socket & { _trigger: (e: string, ...a: unknown[]) => Promise<void> };
        registerDriverHandlers(socket);
        await socket._trigger('driver:go-offline');
        expect(setDriverOfflineMock).toHaveBeenCalledWith('user-driver-1');
        expect(socket.emit).toHaveBeenCalledWith('driver:go-offline:ack', { success: true, message: 'Driver is now offline' });
    });

    it('driver:location-update calls updateDriverLocation', async () => {
        updateDriverLocationMock.mockResolvedValue({ success: true, message: 'Location updated' });
        const socket = makeSocket('user-driver-1') as Socket & { _trigger: (e: string, ...a: unknown[]) => Promise<void> };
        registerDriverHandlers(socket);
        await socket._trigger('driver:location-update', { lng: 77.6, lat: 12.8 });
        expect(updateDriverLocationMock).toHaveBeenCalledWith('user-driver-1', [77.6, 12.8]);
    });
});
