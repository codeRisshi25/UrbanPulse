import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    clearMocks: true,
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/services/**', 'src/utils/**'],
      exclude: ['src/**/*.test.ts'],
    },
  },
  resolve: {
    // Point to TS source so Vitest doesn't depend on a stale/root-owned dist/
    alias: {
      common: new URL('../../packages/common/index.ts', import.meta.url).pathname,
    },
  },
});
