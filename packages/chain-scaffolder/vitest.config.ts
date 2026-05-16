import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    include: ['__tests__/**/*.test.ts'],
    testTimeout: 30_000,
    coverage: {
      thresholds: {
        perFile: false,
        lines: 60,
        functions: 60,
        branches: 50,
        statements: 60,
      },
    },
  },
});
