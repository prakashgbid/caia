import { defineConfig } from 'vitest/config';

/**
 * Vitest config for @caia-app/executor.
 *
 * Tests focus on the wiring of safety packages (broker, sanitizer,
 * spend-guard) into the dispatcher path. We deliberately avoid spawning
 * `claude` itself — `dispatcher.test.ts` covers pure logic, and the
 * SAFETY-001 broker integration tests assert argv + env composition +
 * UDS round-trip without going through `child_process.spawn`.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['*.test.ts', '**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 10_000,
    hookTimeout: 10_000,
  },
});
