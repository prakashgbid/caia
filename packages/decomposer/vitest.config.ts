import { defineConfig } from 'vitest/config';

/**
 * Vitest config for @chiefaia/decomposer.
 *
 * The original `decomposer.test.ts` was written for Jest and was never
 * actually run (no test script in package.json). This config wires up
 * vitest so the rule-based regression tests
 * (`rule-based-verbs.test.ts`, added 2026-04-30) execute on every PR.
 *
 * Only the new vitest-style test runs here. The legacy Jest-style file
 * is excluded until it is migrated.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/rule-based-verbs.test.ts', 'src/section-cap.test.ts'],
    exclude: ['dist/**', 'node_modules/**', 'src/decomposer.test.ts'],
  },
});
