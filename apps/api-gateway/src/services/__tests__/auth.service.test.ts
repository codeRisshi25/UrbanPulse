import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.hoisted ensures these are created before vi.mock hoisting
const prismaMock = vi.hoisted(() => ({
  user: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  driver: { findUnique: vi.fn(), create: vi.fn(), update: vi.fn() },
  rider: { findUnique: vi.fn(), create: vi.fn() },
  trip: { findFirst: vi.fn(), update: vi.fn() },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
}));

vi.mock('../../utils/db.js', () => ({ default: prismaMock }));
vi.mock('../../utils/password.js', () => ({
  hashPassword: vi.fn().mockResolvedValue('hashed_password'),
  comparePassword: vi.fn(),
}));
vi.mock('../../utils/jwt.js', () => ({
  generateToken: vi.fn().mockReturnValue('mock.jwt.token'),
}));
vi.mock('../../logger.js', () => ({ default: { info: vi.fn(), error: vi.fn(), warn: vi.fn() } }));

import { comparePassword } from '../../utils/password.js';
import { registerUser, loginUser, getUserProfile } from '../auth.service.js';

const mockUser = {
  id: 'user-1',
  name: 'Test User',
  number: '1234567890',
  password: 'hashed_password',
  createdAt: new Date('2024-01-01'),
  updatedAt: new Date('2024-01-01'),
};

describe('auth.service', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── registerUser ──────────────────────────────────────────────

  describe('registerUser', () => {
    it('returns error if user already exists', async () => {
      prismaMock.user.findUnique.mockResolvedValue(mockUser);

      const result = await registerUser({
        name: 'Test',
        number: '1234567890',
        password: 'password',
        role: 'rider',
      });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/already exists/i);
    });

    it('creates rider user successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<typeof mockUser>) => fn(prismaMock));
      prismaMock.user.create.mockResolvedValue(mockUser);
      prismaMock.rider.create.mockResolvedValue({ id: 'rider-1', userId: 'user-1' });

      const result = await registerUser({
        name: 'Test User',
        number: '1234567890',
        password: 'password123',
        role: 'rider',
      });

      expect(result.success).toBe(true);
      expect(result.data?.token).toBe('mock.jwt.token');
      expect(result.data?.user.role).toBe('rider');
      expect(prismaMock.rider.create).toHaveBeenCalledOnce();
      expect(prismaMock.driver.create).not.toHaveBeenCalled();
    });

    it('creates driver user successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);
      prismaMock.$transaction.mockImplementation(async (fn: (tx: typeof prismaMock) => Promise<typeof mockUser>) => fn(prismaMock));
      prismaMock.user.create.mockResolvedValue(mockUser);
      prismaMock.driver.create.mockResolvedValue({ id: 'driver-1', userId: 'user-1', isActive: false });

      const result = await registerUser({
        name: 'Test Driver',
        number: '9999999999',
        password: 'password123',
        role: 'driver',
      });

      expect(result.success).toBe(true);
      expect(result.data?.user.role).toBe('driver');
      expect(prismaMock.driver.create).toHaveBeenCalledOnce();
      expect(prismaMock.rider.create).not.toHaveBeenCalled();
    });
  });

  // ── loginUser ─────────────────────────────────────────────────

  describe('loginUser', () => {
    it('returns error if user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await loginUser({ number: '0000000000', password: 'pw' });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/invalid credentials/i);
    });

    it('returns error if password is wrong', async () => {
      prismaMock.user.findUnique.mockResolvedValue({ ...mockUser, driver: null, rider: { id: 'r1' } });
      vi.mocked(comparePassword).mockResolvedValue(false);

      const result = await loginUser({ number: '1234567890', password: 'wrong' });

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/invalid credentials/i);
    });

    it('logs in rider successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockUser,
        driver: null,
        rider: { id: 'rider-1', userId: 'user-1' },
      });
      vi.mocked(comparePassword).mockResolvedValue(true);

      const result = await loginUser({ number: '1234567890', password: 'correct' });

      expect(result.success).toBe(true);
      expect(result.data?.user.role).toBe('rider');
      expect(result.data?.token).toBe('mock.jwt.token');
    });

    it('logs in driver successfully', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockUser,
        driver: { id: 'driver-1', userId: 'user-1', isActive: true },
        rider: null,
      });
      vi.mocked(comparePassword).mockResolvedValue(true);

      const result = await loginUser({ number: '1234567890', password: 'correct' });

      expect(result.success).toBe(true);
      expect(result.data?.user.role).toBe('driver');
    });
  });

  // ── getUserProfile ────────────────────────────────────────────

  describe('getUserProfile', () => {
    it('returns null if user not found', async () => {
      prismaMock.user.findUnique.mockResolvedValue(null);

      const result = await getUserProfile('non-existent-id');
      expect(result).toBeNull();
    });

    it('returns profile with correct role', async () => {
      prismaMock.user.findUnique.mockResolvedValue({
        ...mockUser,
        driver: { id: 'driver-1' },
        rider: null,
      });

      const profile = await getUserProfile('user-1');

      expect(profile?.role).toBe('driver');
      expect(profile?.number).toBe('1234567890');
    });
  });
});
