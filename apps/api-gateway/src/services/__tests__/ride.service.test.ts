import { describe, it, expect, vi, beforeEach } from 'vitest';

const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  driver: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  rider: { findUnique: vi.fn(), create: vi.fn() },
  trip: { findFirst: vi.fn(), findUnique: vi.fn(), update: vi.fn() },
  rideOffer: { findUnique: vi.fn(), update: vi.fn(), updateMany: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

const queueAddMock = vi.hoisted(() => vi.fn().mockResolvedValue({ id: 'job-1' }));
const redisSetMock = vi.hoisted(() => vi.fn());

vi.mock('../../utils/db.js', () => ({ default: prismaMock }));
vi.mock('../../utils/redis.js', () => ({
  default: { set: redisSetMock, get: vi.fn(), del: vi.fn() },
}));
vi.mock('../../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));
vi.mock('bullmq', () => {
  const QueueMock = vi.fn(function (this: Record<string, unknown>) {
    this.add = queueAddMock;
    this.close = vi.fn().mockResolvedValue(undefined);
  });
  return { Queue: QueueMock };
});

import { createRide, cancelRide, acceptRide, rejectRide, verifyOtp } from '../ride.service.js';

const mockRider = { id: 'rider-1', userId: 'user-1' };
const mockDriver = { id: 'driver-1', userId: 'user-driver-1' };

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

      const result = await cancelRide('user-1', 'trip-1');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no active ride/i);
    });

    it('publishes cancel job to lifecycle queue', async () => {
      prismaMock.rider.findUnique.mockResolvedValue(mockRider);
      prismaMock.trip.findFirst.mockResolvedValue({ id: 'trip-1', riderId: 'rider-1', status: 'REQUESTED' });

      const result = await cancelRide('user-1', 'trip-1');

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/cancellation submitted/i);
      expect(queueAddMock).toHaveBeenCalledWith(
        'lifecycle-cancel',
        expect.objectContaining({
          action: 'CANCEL',
          tripId: 'trip-1',
          reason: 'rider cancelled',
        }),
        expect.objectContaining({ jobId: 'cancel:trip-1' })
      );
    });
  });

  // ── acceptRide ────────────────────────────────────────────────

  describe('acceptRide', () => {
    it('returns error if driver not found', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(null);
      const result = await acceptRide('user-driver-1', 'trip-1', 'offer-1');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/driver not found/i);
    });

    it('returns error if offer is not PENDING', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);
      prismaMock.rideOffer.findUnique.mockResolvedValue({ id: 'offer-1', driverId: 'driver-1', status: 'EXPIRED' });
      const result = await acceptRide('user-driver-1', 'trip-1', 'offer-1');
      expect(result.success).toBe(false);
      expect(result.message).toMatch(/no longer available/i);
    });

    it('publishes accept job after acquiring SETNX lock', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);
      prismaMock.rideOffer.findUnique.mockResolvedValue({ id: 'offer-1', driverId: 'driver-1', status: 'PENDING' });
      redisSetMock.mockResolvedValue('OK'); // SETNX success

      const result = await acceptRide('user-driver-1', 'trip-1', 'offer-1');

      expect(result.success).toBe(true);
      expect(result.message).toMatch(/accepted/i);
      expect(redisSetMock).toHaveBeenCalledWith('ride:lock:trip-1', 'driver-1', 'EX', 300, 'NX');
      expect(queueAddMock).toHaveBeenCalledWith(
        'lifecycle-accept',
        expect.objectContaining({
          action: 'ACCEPT',
          tripId: 'trip-1',
          driverId: 'driver-1',
          offerId: 'offer-1',
        }),
        expect.objectContaining({ jobId: 'accept:trip-1' })
      );
    });

    it('returns error if SETNX lock fails (race condition)', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);
      prismaMock.rideOffer.findUnique.mockResolvedValue({ id: 'offer-1', driverId: 'driver-1', status: 'PENDING' });
      redisSetMock.mockResolvedValue(null); // SETNX failed

      const result = await acceptRide('user-driver-1', 'trip-1', 'offer-1');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already been accepted/i);
    });
  });

  // ── rejectRide ────────────────────────────────────────────────

  describe('rejectRide', () => {
    it('marks offer as REJECTED and triggers cascade', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);
      prismaMock.rideOffer.findUnique.mockResolvedValue({ id: 'offer-1', driverId: 'driver-1', status: 'PENDING' });
      prismaMock.rideOffer.update.mockResolvedValue({ id: 'offer-1', status: 'REJECTED' });
      prismaMock.trip.findUnique.mockResolvedValue({ id: 'trip-1', riderId: 'rider-1' });
      prismaMock.$queryRaw.mockResolvedValue([{ lng: 77.5946, lat: 12.9716 }]);

      const result = await rejectRide('user-driver-1', 'trip-1', 'offer-1');

      expect(result.success).toBe(true);
      expect(prismaMock.rideOffer.update).toHaveBeenCalledWith({
        where: { id: 'offer-1' },
        data: { status: 'REJECTED' },
      });
      // Should trigger cascade matching job
      expect(queueAddMock).toHaveBeenCalledWith(
        'cascade-reject',
        expect.objectContaining({
          tripId: 'trip-1',
          skippedDriverIds: ['user-driver-1'],
        }),
        expect.anything()
      );
    });
  });

  // ── verifyOtp ─────────────────────────────────────────────────

  describe('verifyOtp', () => {
    it('returns error if driver not assigned to trip', async () => {
      prismaMock.driver.findUnique.mockResolvedValue({ id: 'driver-2', userId: 'user-driver-2' });
      prismaMock.trip.findUnique.mockResolvedValue({ id: 'trip-1', driverId: 'driver-1', status: 'ACCEPTED' });

      const result = await verifyOtp('user-driver-2', 'trip-1', '1234');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/not assigned/i);
    });

    it('publishes VERIFY_OTP job when driver is assigned', async () => {
      prismaMock.driver.findUnique.mockResolvedValue(mockDriver);
      prismaMock.trip.findUnique.mockResolvedValue({ id: 'trip-1', driverId: 'driver-1', status: 'ACCEPTED' });

      const result = await verifyOtp('user-driver-1', 'trip-1', '1234');

      expect(result.success).toBe(true);
      expect(queueAddMock).toHaveBeenCalledWith(
        'lifecycle-verify-otp',
        expect.objectContaining({
          action: 'VERIFY_OTP',
          tripId: 'trip-1',
          otp: '1234',
        }),
        expect.anything()
      );
    });
  });
});
