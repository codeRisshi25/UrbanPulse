import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Run tests matching this glob
    include: ['src/**/*.test.ts'],
    // Reset mocks between each test automatically
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
    // Allow importing 'common' workspace package
    alias: {
      common: new URL('../../packages/common/dist/index.js', import.meta.url).pathname,
    },
  },
});
