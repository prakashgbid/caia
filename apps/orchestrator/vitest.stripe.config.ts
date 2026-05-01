import { defineConfig } from 'vitest/config';

/**
 * Vitest config scoped to STRIPE-001 route tests. Runs independently of the
 * main jest config (currently stubbed post-consolidation) so the Stripe
 * integration tests execute in CI without blocking the broader cleanup PR.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/api/routes/stripe.test.ts'],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
});
