import { defineConfig } from '@chiefaia/vitest-config';

export default defineConfig({
  test: {
    include: ['tests/golden/**/*.test.ts'],
    testTimeout: 60_000,
    hookTimeout: 90_000,
  },
});
