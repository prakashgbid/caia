import { test, expect } from '@playwright/test';

/**
 * Full happy-path E2E: starting at /, the wizard auto-creates the dev
 * tenant, walks through all 15 mandatory categories using the
 * `caia-managed` / `none` / `email-magic-link` providers (no real
 * external creds needed), and lands on the completion banner.
 *
 * Identity and pricing categories need a tiny bit of input — we drive
 * those via the JSON API to keep the test fast + hermetic.
 */

const MANDATORY = [
  'identity',
  'auth',
  'pricing',
  'repo',
  'ci',
  'cloud',
  'domain',
  'dns',
  'cdn',
  'database',
  'email',
  'analytics',
  'errors',
  'observability',
  'pm',
] as const;

const PROVIDER_BY_CATEGORY: Record<
  string,
  { providerId: string; choices?: Record<string, unknown>; credentials?: Record<string, string> }
> = {
  identity: {
    providerId: 'self',
    choices: { ownerEmail: 'p@example.com', timezone: 'UTC', locale: 'en-US' },
  },
  auth: { providerId: 'email-magic-link' },
  pricing: { providerId: 'credits', credentials: { stripe_payment_method_id: 'pm_test123' } },
  repo: { providerId: 'caia-managed' },
  ci: { providerId: 'caia-managed' },
  cloud: { providerId: 'caia-managed' },
  domain: { providerId: 'manual' },
  dns: { providerId: 'none' },
  cdn: { providerId: 'caia-managed' },
  database: { providerId: 'caia-managed' },
  email: { providerId: 'caia-managed' },
  analytics: { providerId: 'none' },
  errors: { providerId: 'cloudflare-logpush' },
  observability: { providerId: 'none' },
  pm: { providerId: 'caia-managed' },
};

test.describe.configure({ mode: 'serial' });

test('signup → 15 categories → onboarding-complete', async ({ page, request }) => {
  // landing page redirects to /onboarding/<next>
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding\//);

  for (const cat of MANDATORY) {
    const spec = PROVIDER_BY_CATEGORY[cat];
    const res = await request.post('/api/onboarding/submit', {
      data: {
        tenantId: 'dev-tenant',
        category: cat,
        providerId: spec!.providerId,
        choices: spec!.choices ?? {},
        credentials: spec!.credentials ?? {},
      },
    });
    expect(res.status(), `submit ${cat}`).toBe(200);
    const body = await res.json();
    expect(body.status, `${cat} status (msg: ${body.validator?.message})`).toBe(
      'passed',
    );
  }

  // Final state must mark every required step passed.
  const stateRes = await request.get('/api/onboarding/state?tenantId=dev-tenant');
  expect(stateRes.status()).toBe(200);
  const state = await stateRes.json();
  const mandatorySteps = state.steps.filter(
    (s: { category: { required: boolean } }) => s.category.required,
  );
  const pending = mandatorySteps
    .filter((s: { status: string }) => !['passed', 'deferred'].includes(s.status))
    .map((s: { category: { id: string }; status: string }) =>
      `${s.category.id}=${s.status}`,
    );
  expect(pending, `pending steps: ${pending.join(', ')}`).toEqual([]);
  expect(state.ready).toBe(true);

  // Reload the page — landing should now redirect to /onboarding/complete
  await page.goto('/');
  await expect(page).toHaveURL(/\/onboarding\/complete/);
  await expect(page.getByTestId('onboarding-complete')).toBeVisible();
});

test('audit log contains credential.put for every storable cred', async ({ request }) => {
  const res = await request.get('/api/onboarding/log?tenantId=dev-tenant');
  expect(res.status()).toBe(200);
  const body = await res.json();
  const actions = new Set<string>(body.entries.map((e: { action: string }) => e.action));
  expect(actions.has('onboarding.step.passed')).toBe(true);
  expect(actions.has('onboarding.completed')).toBe(true);
});

test('rejects unknown provider', async ({ request }) => {
  const res = await request.post('/api/onboarding/submit', {
    data: {
      tenantId: 'dev-tenant',
      category: 'repo',
      providerId: 'fictional',
      choices: {},
      credentials: {},
    },
  });
  expect(res.status()).toBe(400);
});
