import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    coverage: {
      thresholds: {
        perFile: false,
        lines: 70,
        functions: 70,
        branches: 65,
        statements: 70,
      },
    },
  },
});
