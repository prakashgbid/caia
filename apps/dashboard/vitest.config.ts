import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Dashboard unit-test config — runs `tests/*.test.ts(x)` only. Playwright
 * specs (`tests/*.spec.ts`) are excluded because they need a running
 * Next.js dev server + a browser, which Playwright manages itself.
 *
 * `@chiefaia/atlas-mapper` ships uncompiled source (no `dist/` build),
 * so we point Vite at its `src/index.ts` entry explicitly. This mirrors
 * what tsc does at production build time via tsconfig paths.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@chiefaia/atlas-mapper': path.resolve(
        __dirname,
        '../../packages/atlas-mapper/src/index.ts',
      ),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'tests/**/*.spec.ts'],
  },
});
