import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Facade tests resolve the workspace dependencies directly to their `src/`
 * entries so we don't depend on a built `dist/` from principal-engineer.
 * Production consumers resolve via the published / built packages.
 */
export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    reporters: ['default'],
  },
  resolve: {
    alias: {
      '@caia/principal-engineer': resolve(__dirname, '../principal-engineer/src/index.ts'),
      '@chiefaia/decomposer-recursive': resolve(__dirname, '../decomposer-recursive/src/index.ts'),
      '@caia/architect-kit': resolve(__dirname, '../architect-kit/src/index.ts'),
    },
  },
});
