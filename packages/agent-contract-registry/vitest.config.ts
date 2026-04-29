import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    reporters: ['default'],
    benchmark: {
      include: ['src/**/*.bench.ts', 'tests/**/*.bench.ts'],
    },
  },
});
