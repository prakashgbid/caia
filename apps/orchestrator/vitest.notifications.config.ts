import { defineConfig } from 'vitest/config';

/**
 * Vitest config scoped to NOTIF-001 notification store DB round-trip tests.
 * Runs the NotificationStore SQLite integration tests independently of the
 * main jest config (currently stubbed post-consolidation).
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/notifications/store.test.ts', 'tests/notifications/enqueue-drain.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
});
