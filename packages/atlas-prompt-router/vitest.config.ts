import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const here = (p: string): string => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    testTimeout: 30000,
  },
  resolve: {
    alias: [
      {
        find: /^@caia\/atlas-ui\/fixtures\/prakash-tiwari-home(\.js)?$/,
        replacement: here('../atlas-ui/fixtures/prakash-tiwari-home.ts'),
      },
      {
        find: /^@caia\/atlas-ui\/fixtures$/,
        replacement: here('../atlas-ui/fixtures/index.ts'),
      },
    ],
  },
});
