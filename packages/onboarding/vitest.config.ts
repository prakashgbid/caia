import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**'],
    coverage: {
      thresholds: {
        perFile: false,
        lines: 70,
        functions: 70,
        branches: 70,
        statements: 70,
      },
    },
  },
});
