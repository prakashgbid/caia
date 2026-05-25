import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    include: ['tests/unit/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
  },
});
