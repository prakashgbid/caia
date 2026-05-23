/**
 * Vitest config for `@caia/atlas-ui`.
 *
 * Two environments:
 *   - `node` for pure-logic suites (bridge protocol, reducers, selectors)
 *   - `jsdom` for component-render tests via @testing-library/react
 *
 * We pick environment per-file using the file path: anything under
 * `tests/unit/dom/` runs in jsdom; everything else under `tests/unit/`
 * runs in node. This keeps the cheap suites cheap.
 *
 * `pool: 'forks'` because vitest's default thread pool calls
 * `window.close()` on the JSDOM window between tests, and JSDOM 25
 * no longer exposes `Window.prototype.close` on framed windows —
 * the teardown raises an uncatchable unhandled error per worker.
 * Switching to forks side-steps the cross-worker window reuse.
 */

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    exclude: ['tests/e2e/**', 'node_modules/**', 'dist/**'],
    globals: true,
    setupFiles: ['./tests/unit/setup.ts'],
    environment: 'node',
    environmentMatchGlobs: [['tests/unit/dom/**', 'jsdom']],
    testTimeout: 10000,
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: false },
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/**/*.stories.tsx', 'src/**/index.ts'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 75,
        statements: 80,
      },
    },
  },
});
