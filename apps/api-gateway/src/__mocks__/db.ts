// Vitest auto-mock for Prisma client
// Used by vi.mock('../utils/db.js') in tests
import { vi } from 'vitest';

const prismaMock = {
  user: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  driver: {
    findUnique: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  rider: {
    findUnique: vi.fn(),
    create: vi.fn(),
  },
  trip: {
    findFirst: vi.fn(),
    update: vi.fn(),
  },
  $transaction: vi.fn(),
  $queryRaw: vi.fn(),
};

export default prismaMock;
