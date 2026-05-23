import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      'tests/integration/**',
      'tests/**/*.integration.test.ts',
    ],
    testTimeout: 15_000,
  },
});
