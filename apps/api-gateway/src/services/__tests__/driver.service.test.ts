import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  driver: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  rider: { findUnique: vi.fn(), create: vi.fn() },
  trip: { findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

const redisMock = vi.hoisted(() => ({
  geoadd: vi.fn(),
  geopos: vi.fn(),
  zrem: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  ping: vi.fn(),
}));

vi.mock('../../utils/db.js', () => ({ default: prismaMock }));
vi.mock('../../utils/redis.js', () => ({ default: redisMock }));
vi.mock('../../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import {
  setDriverOnline,
  setDriverOffline,
  updateDriverLocation,
  getNearbyAvailableRides,
} from '../driver.service.js';

const mockDriver = { id: 'driver-1', userId: 'user-1', isActive: false };
const activeDriver = { ...mockDriver, isActive: true };

describe('driver.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── setDriverOnline ───────────────────────────────────────────

  describe('setDriverOnline', () => {
    it('returns error if driver profile not found', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(null);

      const result = await setDriverOnline('user-1', [77.59, 12.97]);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/driver profile not found/i);
    });

    it('adds driver to Redis GEO and sets heartbeat', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);
      redisMock.geoadd.mockResolvedValue(1);
      redisMock.set.mockResolvedValue('OK');
      prismaMock.driver.update.mockResolvedValue({ ...activeDriver });

      const result = await setDriverOnline('user-1', [77.59, 12.97]);

      expect(result.success).toBe(true);
      expect(redisMock.geoadd).toHaveBeenCalledWith('drivers:active', 77.59, 12.97, 'driver-1');
      expect(redisMock.set).toHaveBeenCalledWith(
        'driver:heartbeat:driver-1',
        '1',
        'EX',
        60
      );
      expect(prismaMock.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { isActive: true },
      });
    });
  });

  // ── setDriverOffline ──────────────────────────────────────────

  describe('setDriverOffline', () => {
    it('returns error if driver profile not found', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(null);

      const result = await setDriverOffline('user-1');
      expect(result.success).toBe(false);
    });

    it('removes driver from Redis GEO and clears heartbeat', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);
      redisMock.zrem.mockResolvedValue(1);
      redisMock.del.mockResolvedValue(1);
      prismaMock.driver.update.mockResolvedValue({ ...mockDriver, isActive: false });

      const result = await setDriverOffline('user-1');

      expect(result.success).toBe(true);
      expect(redisMock.zrem).toHaveBeenCalledWith('drivers:active', 'driver-1');
      expect(redisMock.del).toHaveBeenCalledWith('driver:heartbeat:driver-1');
      expect(prismaMock.driver.update).toHaveBeenCalledWith({
        where: { id: 'driver-1' },
        data: { isActive: false },
      });
    });
  });

  // ── updateDriverLocation ──────────────────────────────────────

  describe('updateDriverLocation', () => {
    it('returns error if driver is offline', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver); // isActive: false

      const result = await updateDriverLocation('user-1', [77.59, 12.97]);
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/must be online/i);
      expect(redisMock.geoadd).not.toHaveBeenCalled();
    });

    it('updates Redis GEO and refreshes heartbeat when online', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(activeDriver);
      redisMock.geoadd.mockResolvedValue(0); // 0 = updated, not new
      redisMock.set.mockResolvedValue('OK');

      const result = await updateDriverLocation('user-1', [77.60, 12.98]);

      expect(result.success).toBe(true);
      expect(redisMock.geoadd).toHaveBeenCalledWith('drivers:active', 77.60, 12.98, 'driver-1');
      expect(redisMock.set).toHaveBeenCalledWith(
        'driver:heartbeat:driver-1',
        '1',
        'EX',
        60
      );
    });
  });

  // ── getNearbyAvailableRides ───────────────────────────────────

  describe('getNearbyAvailableRides', () => {
    it('returns error if driver is offline', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);

      const result = await getNearbyAvailableRides('user-1');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/must be online/i);
    });

    it('returns error if driver position not in Redis', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(activeDriver);
      redisMock.geopos.mockResolvedValue([null]);

      const result = await getNearbyAvailableRides('user-1');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/location not found/i);
    });

    it('returns nearby REQUESTED trips', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(activeDriver);
      redisMock.geopos.mockResolvedValue([['77.5946', '12.9716']]);
      prismaMock.$queryRaw.mockResolvedValue([
        {
          id: 'trip-1',
          riderId: 'rider-1',
          pickupLocation: 'POINT(77.5946 12.9716)',
          dropoffLocation: 'POINT(77.6046 12.9816)',
          status: 'REQUESTED',
          createdAt: new Date(),
        },
      ]);

      const result = await getNearbyAvailableRides('user-1');

      expect(result.success).toBe(true);
      expect((result.data?.rides as unknown[]).length).toBe(1);
      expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
    });
  });
});
