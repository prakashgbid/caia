import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    // E2E tests run via playwright, not vitest
    exclude: ['tests/e2e/**', 'node_modules/**'],
    env: {
      NODE_ENV: 'development',
    },
  },
});
