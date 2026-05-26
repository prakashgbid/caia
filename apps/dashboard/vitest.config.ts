import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * Dashboard unit-test config — runs `tests/**\/*.test.ts(x)` only.
 * Playwright specs (`tests/**\/*.spec.ts`) are excluded because they
 * need a running Next.js dev server + a browser, which Playwright
 * manages itself.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/wizard/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'tests/**/*.spec.ts'],
  },
});
