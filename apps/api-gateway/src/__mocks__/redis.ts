// Vitest auto-mock for Redis client
import { vi } from 'vitest';

const redisMock = {
  geoadd: vi.fn(),
  geopos: vi.fn(),
  zrem: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
  ping: vi.fn(),
  call: vi.fn(),
};

export default redisMock;
