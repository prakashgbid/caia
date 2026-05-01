import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/recommendations/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
});
