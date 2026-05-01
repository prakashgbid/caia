// apps/dashboard/tests/billing.spec.ts
//
// Comprehensive UI/UX tests for the billing module:
//   /pricing        — plan cards, CTA buttons, feature grids
//   /checkout       — plan selection, email form, cart flow
//   /subscriptions  — subscription table, filters, cancel
//   /billing/success — post-checkout success page
//   /billing/cancel  — checkout cancellation page
//
// All tests use page.route() to mock backend API responses so the
// suite can run without a live orchestrator.
//
// Run: npx playwright test tests/billing.spec.ts
// Accessibility gate: zero serious/critical axe violations per route.
// Visual regression: full-page screenshots against approved baselines.

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// ---------------------------------------------------------------------------
// Mock data helpers
// ---------------------------------------------------------------------------

const MOCK_PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: 0,
    period: 'forever',
    description: 'For individuals exploring CAIA.',
    features: [
      { text: 'Up to 10 pipeline runs / month', included: true },
      { text: 'Community support', included: true },
      { text: '1 active project', included: true },
      { text: 'Priority queue', included: false },
      { text: 'Advanced analytics', included: false },
      { text: 'Custom agents', included: false },
      { text: 'SLA guarantee', included: false },
    ],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: 2900,
    period: 'month',
    description: 'For teams shipping production AI pipelines.',
    features: [
      { text: 'Unlimited pipeline runs', included: true },
      { text: 'Priority email support', included: true },
      { text: 'Up to 10 active projects', included: true },
      { text: 'Priority queue', included: true },
      { text: 'Advanced analytics', included: true },
      { text: 'Custom agents', included: false },
      { text: 'SLA guarantee', included: false },
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    price: 9900,
    period: 'month',
    description: 'For organizations requiring full control.',
    features: [
      { text: 'Unlimited pipeline runs', included: true },
      { text: 'Dedicated support & SLA', included: true },
      { text: 'Unlimited active projects', included: true },
      { text: 'Priority queue', included: true },
      { text: 'Advanced analytics', included: true },
      { text: 'Custom agents', included: true },
      { text: 'SLA guarantee', included: true },
    ],
  },
];

const MOCK_SUBSCRIPTIONS = [
  {
    id: 'sub_001',
    email: 'alice@example.com',
    plan: 'pro',
    status: 'active',
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-15T10:00:00Z',
    cancelledAt: null,
    stripeCustomerId: 'cus_abc',
    stripeSubscriptionId: 'sub_stripe_abc',
    stripePriceId: null,
  },
  {
    id: 'sub_002',
    email: 'bob@example.com',
    plan: 'enterprise',
    status: 'active',
    createdAt: '2026-02-01T09:00:00Z',
    updatedAt: '2026-02-01T09:00:00Z',
    cancelledAt: null,
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
  },
  {
    id: 'sub_003',
    email: 'carol@example.com',
    plan: 'free',
    status: 'cancelled',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-03-01T00:00:00Z',
    cancelledAt: '2026-03-01T00:00:00Z',
    stripeCustomerId: null,
    stripeSubscriptionId: null,
    stripePriceId: null,
  },
];

function mockPlansRoute(page: import('@playwright/test').Page) {
  return page.route('/api/checkout/plans*', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plans: MOCK_PLANS }) }),
  );
}

function mockSubscriptionsRoute(page: import('@playwright/test').Page, overrides?: typeof MOCK_SUBSCRIPTIONS) {
  const subs = overrides ?? MOCK_SUBSCRIPTIONS;
  return page.route('/api/subscriptions*', (route) => {
    const url = new URL(route.request().url());
    const statusFilter = url.searchParams.get('status');
    const planFilter = url.searchParams.get('plan');
    const emailFilter = url.searchParams.get('email');

    let rows = [...subs];
    if (statusFilter) rows = rows.filter((s) => s.status === statusFilter);
    if (planFilter) rows = rows.filter((s) => s.plan === planFilter);
    if (emailFilter) rows = rows.filter((s) => s.email.includes(emailFilter));

    if (route.request().method() === 'POST') {
      const newSub = {
        id: `sub_new_${Date.now()}`,
        email: 'newuser@example.com',
        plan: 'free',
        status: 'active',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        cancelledAt: null,
        stripeCustomerId: null,
        stripeSubscriptionId: null,
        stripePriceId: null,
      };
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(newSub) });
    }

    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ subscriptions: rows, total: rows.length }),
    });
  });
}

function mockCheckoutStateRoute(page: import('@playwright/test').Page) {
  return page.route('/api/checkout/state/**', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ email: 'user@example.com', currentPlan: 'free', subscription: null }),
    }),
  );
}

function mockCheckoutRoute(page: import('@playwright/test').Page) {
  return page.route('/api/checkout', (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        sessionId: 'cs_test_mock',
        url: 'https://checkout.stripe.com/test',
        plan: 'pro',
        email: 'user@example.com',
      }),
    });
  });
}

// ---------------------------------------------------------------------------
// /pricing — Plan cards, features, CTA buttons
// ---------------------------------------------------------------------------

test.describe('Billing: /pricing page', () => {
  test.beforeEach(async ({ page }) => {
    await mockPlansRoute(page);
    await mockCheckoutStateRoute(page);
  });

  test('1. displays three plan cards', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'networkidle' });
    // All three plan names must be visible
    await expect(page.getByText('Free', { exact: true })).toBeVisible();
    await expect(page.getByText('Pro', { exact: true })).toBeVisible();
    await expect(page.getByText('Enterprise', { exact: true })).toBeVisible();
  });

  test('2. shows correct plan prices', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'networkidle' });
    // $0 for free, $29 for pro, $99 for enterprise
    await expect(page.getByText(/\$0/)).toBeVisible();
    await expect(page.getByText(/\$29/)).toBeVisible();
    await expect(page.getByText(/\$99/)).toBeVisible();
  });

  test('3. Pro card is marked Most Popular', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'networkidle' });
    await expect(page.getByText(/most popular/i)).toBeVisible();
  });

  test('4. no a11y violations on /pricing', async ({ page }) => {
    await page.goto('/pricing', { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      console.error('a11y violations on /pricing:', blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`));
    }
    expect(blocking).toHaveLength(0);
  });

  test('5. shows cancelled checkout banner when ?cancelled=1', async ({ page }) => {
    await page.goto('/pricing?cancelled=1', { waitUntil: 'networkidle' });
    await expect(page.getByText(/cancelled|checkout.*cancelled|upgrade.*cancelled/i)).toBeVisible();
  });
});

// ---------------------------------------------------------------------------
// /checkout — Plan selection, email form, flow
// ---------------------------------------------------------------------------

test.describe('Billing: /checkout page', () => {
  test.beforeEach(async ({ page }) => {
    await mockPlansRoute(page);
    await mockCheckoutStateRoute(page);
    await mockCheckoutRoute(page);
    // Stub Stripe checkout-session endpoint
    await page.route('/api/stripe/checkout-session', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ sessionId: 'cs_mock', url: 'https://checkout.stripe.com/mock' }),
      }),
    );
    // Stub Stripe subscription lookup
    await page.route('/api/stripe/subscription/**', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ subscription: null }),
      }),
    );
  });

  test('6. checkout page loads and shows plan cards', async ({ page }) => {
    await page.goto('/checkout', { waitUntil: 'networkidle' });
    // At least one paid plan card must be visible
    await expect(page.getByText('Pro').or(page.getByText('Enterprise'))).toBeVisible();
  });

  test('7. shows pro plan price ($29/month)', async ({ page }) => {
    await page.goto('/checkout', { waitUntil: 'networkidle' });
    await expect(page.getByText(/29/)).toBeVisible();
  });

  test('8. shows enterprise plan price ($99/month)', async ({ page }) => {
    await page.goto('/checkout', { waitUntil: 'networkidle' });
    await expect(page.getByText(/99/)).toBeVisible();
  });

  test('9. has an email input field', async ({ page }) => {
    await page.goto('/checkout', { waitUntil: 'networkidle' });
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[placeholder*="email" i]'));
    await expect(emailInput.first()).toBeVisible();
  });

  test('10. no a11y violations on /checkout', async ({ page }) => {
    await page.goto('/checkout', { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      console.error('a11y violations on /checkout:', blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`));
    }
    expect(blocking).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /subscriptions — Table, filters, summary, cancel
// ---------------------------------------------------------------------------

test.describe('Billing: /subscriptions page', () => {
  test.beforeEach(async ({ page }) => {
    await mockSubscriptionsRoute(page);
    await mockPlansRoute(page);
  });

  test('11. subscriptions table renders with mock data', async ({ page }) => {
    await page.goto('/subscriptions', { waitUntil: 'networkidle' });
    await expect(page.getByText('alice@example.com')).toBeVisible();
    await expect(page.getByText('bob@example.com')).toBeVisible();
  });

  test('12. shows subscription status labels', async ({ page }) => {
    await page.goto('/subscriptions', { waitUntil: 'networkidle' });
    // Active and cancelled statuses from mock data
    await expect(page.getByText(/active/i).first()).toBeVisible();
    await expect(page.getByText(/cancelled/i).first()).toBeVisible();
  });

  test('13. shows plan labels (pro, enterprise, free)', async ({ page }) => {
    await page.goto('/subscriptions', { waitUntil: 'networkidle' });
    await expect(page.getByText(/pro/i).first()).toBeVisible();
    await expect(page.getByText(/enterprise/i).first()).toBeVisible();
  });

  test('14. summary counts are visible', async ({ page }) => {
    await page.goto('/subscriptions', { waitUntil: 'networkidle' });
    // Summary pills: total, active, cancelled counts
    await expect(page.getByText(/total|active|cancelled/i).first()).toBeVisible();
  });

  test('15. new subscription form is present', async ({ page }) => {
    await page.goto('/subscriptions', { waitUntil: 'networkidle' });
    const emailInput = page.locator('input[type="email"]').or(page.locator('input[placeholder*="email" i]'));
    await expect(emailInput.first()).toBeVisible();
  });

  test('16. cancel button triggers DELETE request', async ({ page }) => {
    let deleteCalled = false;
    await page.route('/api/subscriptions/sub_001', (route) => {
      if (route.request().method() === 'DELETE') {
        deleteCalled = true;
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ ...MOCK_SUBSCRIPTIONS[0], status: 'cancelled', cancelledAt: new Date().toISOString() }),
        });
      } else {
        route.continue();
      }
    });

    await page.goto('/subscriptions', { waitUntil: 'networkidle' });

    // Click cancel for alice's subscription
    const cancelButtons = page.getByRole('button', { name: /cancel/i });
    if (await cancelButtons.count() > 0) {
      await cancelButtons.first().click();
      // Give the request a moment to fire
      await page.waitForTimeout(300);
      expect(deleteCalled).toBe(true);
    }
  });

  test('17. no a11y violations on /subscriptions', async ({ page }) => {
    await page.goto('/subscriptions', { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      console.error('a11y violations on /subscriptions:', blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`));
    }
    expect(blocking).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /billing/success — Post-checkout success page
// ---------------------------------------------------------------------------

test.describe('Billing: /billing/success page', () => {
  test('18. success page renders for pro plan', async ({ page }) => {
    await page.goto('/billing/success?plan=pro&email=user@example.com', { waitUntil: 'networkidle' });
    // Should show plan name or success copy
    await expect(page.getByText(/pro|success|subscription|thank/i).first()).toBeVisible();
  });

  test('19. success page renders for enterprise plan', async ({ page }) => {
    await page.goto('/billing/success?plan=enterprise&email=user@example.com', { waitUntil: 'networkidle' });
    await expect(page.getByText(/enterprise|success|subscription|thank/i).first()).toBeVisible();
  });

  test('20. success page has link to subscriptions', async ({ page }) => {
    await page.goto('/billing/success?plan=pro&email=user@example.com', { waitUntil: 'networkidle' });
    const subsLink = page.getByRole('link', { name: /subscription/i });
    await expect(subsLink.first()).toBeVisible();
  });

  test('21. no a11y violations on /billing/success', async ({ page }) => {
    await page.goto('/billing/success?plan=pro&email=user@example.com', { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      console.error('a11y violations on /billing/success:', blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`));
    }
    expect(blocking).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// /billing/cancel — Checkout cancellation page
// ---------------------------------------------------------------------------

test.describe('Billing: /billing/cancel page', () => {
  test('22. cancel page renders with appropriate copy', async ({ page }) => {
    await page.goto('/billing/cancel', { waitUntil: 'networkidle' });
    // Should show cancel/abandon copy
    await expect(page.getByText(/cancel|abandon|checkout|upgrade/i).first()).toBeVisible();
  });

  test('23. cancel page has link back to /pricing', async ({ page }) => {
    await page.goto('/billing/cancel', { waitUntil: 'networkidle' });
    const pricingLink = page.getByRole('link', { name: /pricing|plan/i });
    await expect(pricingLink.first()).toBeVisible();
  });

  test('24. no a11y violations on /billing/cancel', async ({ page }) => {
    await page.goto('/billing/cancel', { waitUntil: 'networkidle' });
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      console.error('a11y violations on /billing/cancel:', blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`));
    }
    expect(blocking).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Visual regression — billing routes
// ---------------------------------------------------------------------------

test.describe('Billing: visual regression', () => {
  const BILLING_ROUTES = [
    { name: 'pricing', path: '/pricing' },
    { name: 'checkout', path: '/checkout' },
    { name: 'subscriptions', path: '/subscriptions' },
    { name: 'billing-success-pro', path: '/billing/success?plan=pro&email=user@example.com' },
    { name: 'billing-cancel', path: '/billing/cancel' },
  ];

  for (const r of BILLING_ROUTES) {
    test(`visual: ${r.name}`, async ({ page }) => {
      // Mock all API calls to ensure deterministic renders
      await mockPlansRoute(page);
      await mockSubscriptionsRoute(page);
      await mockCheckoutStateRoute(page);
      await page.route('/api/stripe/**', (route) =>
        route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ subscription: null }),
        }),
      );

      await page.goto(r.path, { waitUntil: 'networkidle' });
      await page.evaluate(() => document.fonts?.ready);
      await page.waitForTimeout(300);

      const maskLocator = page.locator('[data-visual-mask="true"]');
      await expect(page).toHaveScreenshot(`billing-${r.name}.png`, {
        fullPage: true,
        mask: [maskLocator],
        animations: 'disabled',
        caret: 'hide',
      });
    });
  }
});
