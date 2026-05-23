import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    include: [
      'tests/integration/**/*.test.ts',
      'tests/**/*.integration.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/dist/**'],
    testTimeout: 120_000,
    hookTimeout: 60_000,
  },
});
