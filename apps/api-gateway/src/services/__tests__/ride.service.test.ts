import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  driver: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  rider: { findUnique: vi.fn(), create: vi.fn() },
  trip: { findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-1' }));

vi.mock('../../utils/db.js', () => ({ default: prismaMock }));
vi.mock('../../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('bullmq', () => {
  const QueueMock = vi.fn(function (this: Record<string, unknown>) {
    this.add = queueAddMock;
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  return { Queue: QueueMock };
});

import { createRide, cancelRide } from '../ride.service.js';

const mockRider = { id: 'rider-1', userId: 'user-1' };

const mockRideRow = {
  id: 'trip-1',
  riderId: 'rider-1',
  pickupLocation: 'POINT(77.5946 12.9716)',
  dropoffLocation: 'POINT(77.6046 12.9816)',
  status: 'REQUESTED',
  createdAt: new Date('2024-01-01'),
};

describe('ride.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── createRide ────────────────────────────────────────────────

  describe('createRide', () => {
    it('returns error if rider not found', async () => {
      prismaMock.rider.findUnique.mockResolvedValue(null);

      const result = await createRide(
        { pickupLocation: [77.5946, 12.9716], dropoffLocation: [77.6046, 12.9816] },
        'user-1'
      );

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/rider not found/i);
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
    });

    it('creates ride and returns trip data', async () => {
      prismaMock.rider.findUnique.mockResolvedValue(mockRider);
      prismaMock.$queryRaw.mockResolvedValue([mockRideRow]);

      const result = await createRide(
        { pickupLocation: [77.5946, 12.9716], dropoffLocation: [77.6046, 12.9816] },
        'user-1'
      );

      expect(result.success).toBe(true);
      expect(result.data?.id).toBe('trip-1');
      expect(result.data?.status).toBe('REQUESTED');
      expect(prismaMock.$queryRaw).toHaveBeenCalledOnce();
      // M2: verify ride job is published to BullMQ queue
      expect(queueAddMock).toHaveBeenCalledWith(
        'new-ride',
        expect.objectContaining({
          tripId: 'trip-1',
          riderId: 'rider-1',
          pickupLng: 77.5946,
          pickupLat: 12.9716,
        }),
        { jobId: 'trip-1' }
      );
    });
  });

  // ── cancelRide ────────────────────────────────────────────────

  describe('cancelRide', () => {
    it('returns error if no active ride found', async () => {
      prismaMock.rider.findUnique.mockResolvedValue(mockRider);
      prismaMock.trip.findFirst.mockResolvedValue(null);

      const result = await cancelRide('user-1');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no active ride/i);
      expect(prismaMock.trip.update).not.toHaveBeenCalled();
    });

    it('cancels the ride and returns success', async () => {
      prismaMock.rider.findUnique.mockResolvedValue(mockRider);
      prismaMock.trip.findFirst.mockResolvedValue({ id: 'trip-1', riderId: 'rider-1', status: 'REQUESTED' });
      prismaMock.trip.update.mockResolvedValue({ id: 'trip-1', status: 'CANCELLED' });

      const result = await cancelRide('user-1');

      expect(result.success).toBe(true);
      expect(prismaMock.trip.update).toHaveBeenCalledWith({
        where: { id: 'trip-1' },
        data: { status: 'CANCELLED' },
      });
    });
  });
});
