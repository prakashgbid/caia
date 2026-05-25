import { defineConfig } from 'vitest/config';

// Integration tests boot a real nats-server (via testcontainers or
// a side-loaded process). Slow; run separately from unit tests.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    testTimeout: 60_000,
    hookTimeout: 60_000,
    include: ['tests/integration/**/*.test.ts'],
  },
});
