import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'jsdom',
    testTimeout: 15_000,
  },
});
