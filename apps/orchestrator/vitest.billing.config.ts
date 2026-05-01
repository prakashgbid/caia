import { defineConfig } from 'vitest/config';

/**
 * Vitest config scoped to BILLING-001 checkout route tests plus STRIPE-001
 * stripe route tests. Runs both billing-related test suites in one pass.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: [
      'src/api/routes/checkout.test.ts',
      'src/api/routes/subscriptions.test.ts',
      'src/api/routes/stripe.test.ts',
      'src/api/routes/stripe.webhook.test.ts',
    ],
    exclude: ['dist/**', 'node_modules/**'],
    testTimeout: 10_000,
  },
});
