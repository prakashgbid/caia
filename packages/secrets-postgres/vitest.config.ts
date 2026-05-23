import { defineConfig } from '@chiefaia/vitest-config';
export default defineConfig({
  test: {
    exclude: ['**/node_modules/**', '**/dist/**', 'tests/integration/**'],
  },
});
