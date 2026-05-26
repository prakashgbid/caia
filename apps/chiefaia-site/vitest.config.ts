import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

/**
 * chiefaia-site vitest config.
 *
 * jsdom environment so component tests can render with @testing-library/react.
 * Excludes any future Playwright `*.spec.ts` files (Playwright manages its own
 * runtime; vitest should not try to execute those).
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    exclude: ['node_modules', 'tests/**/*.spec.ts'],
  },
});
