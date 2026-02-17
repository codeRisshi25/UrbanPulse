import { describe, it, expect } from 'vitest';
import { driverStatusSchema, driverLocationSchema, rideSchema } from 'common';

describe('Zod Schemas', () => {

  // ── driverStatusSchema ────────────────────────────────────────

  describe('driverStatusSchema', () => {
    it('accepts going offline without location', () => {
      const result = driverStatusSchema.safeParse({ body: { isActive: false } });
      expect(result.success).toBe(true);
    });

    it('accepts going online with location', () => {
      const result = driverStatusSchema.safeParse({
        body: { isActive: true, location: [77.59, 12.97] },
      });
      expect(result.success).toBe(true);
    });

    it('rejects going online without location (refine)', () => {
      const result = driverStatusSchema.safeParse({
        body: { isActive: true },
      });
      expect(result.success).toBe(false);
      if (!result.success) {
        const paths = result.error.issues.map((i) => i.path.join('.'));
        expect(paths).toContain('body.location');
      }
    });

    it('rejects non-boolean isActive', () => {
      const result = driverStatusSchema.safeParse({
        body: { isActive: 'yes' },
      });
      expect(result.success).toBe(false);
    });

    it('rejects location with wrong length', () => {
      const result = driverStatusSchema.safeParse({
        body: { isActive: true, location: [77.59] },
      });
      expect(result.success).toBe(false);
    });
  });

  // ── driverLocationSchema ──────────────────────────────────────

  describe('driverLocationSchema', () => {
    it('accepts valid [lon, lat] tuple', () => {
      const result = driverLocationSchema.safeParse({
        body: { location: [77.5946, 12.9716] },
      });
      expect(result.success).toBe(true);
    });

    it('rejects string coordinates', () => {
      const result = driverLocationSchema.safeParse({
        body: { location: ['77.59', '12.97'] },
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing location', () => {
      const result = driverLocationSchema.safeParse({ body: {} });
      expect(result.success).toBe(false);
    });
  });

  // ── rideSchema ────────────────────────────────────────────────

  describe('rideSchema', () => {
    it('accepts valid pickup and dropoff coordinates', () => {
      const result = rideSchema.safeParse({
        body: {
          pickupLocation: [77.5946, 12.9716],
          dropoffLocation: [77.6046, 12.9816],
        },
      });
      expect(result.success).toBe(true);
    });

    it('rejects locations with wrong number of elements', () => {
      const result = rideSchema.safeParse({
        body: {
          pickupLocation: [77.5946],
          dropoffLocation: [77.6046, 12.9816],
        },
      });
      expect(result.success).toBe(false);
    });

    it('rejects missing dropoffLocation', () => {
      const result = rideSchema.safeParse({
        body: { pickupLocation: [77.5946, 12.9716] },
      });
      expect(result.success).toBe(false);
    });
  });
});
