import { defineConfig } from 'vitest/config';

/**
 * Vitest config scoped to SAFETY-* unit tests. The orchestrator's main
 * jest config is currently stubbed (stale module paths post-
 * consolidation, separate cleanup PR). This config runs only the
 * SAFETY-002 / SAFETY-003 / SAFETY-004 tests so they actually execute
 * in CI without unblocking the larger jest cleanup.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/mcp/sandboxed-mcp-config.test.ts', 'src/safety/**/*.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
});
