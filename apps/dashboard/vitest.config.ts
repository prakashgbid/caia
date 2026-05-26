import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Dashboard unit-test config — runs `tests/*.test.ts(x)` only. Playwright
 * specs (`tests/*.spec.ts`) are excluded because they need a running
 * Next.js dev server + a browser, which Playwright manages itself.
 */
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'tests/**/*.spec.ts'],
  },
});
