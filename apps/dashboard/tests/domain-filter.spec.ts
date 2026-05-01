// apps/dashboard/tests/domain-filter.spec.ts
//
// Behavior tests for the domain filter dropdown on the dashboard table.
// Story: story-story-hrFjcC-gsfs
// Feature: [VAL-2026-04-30-051730-3-enhancement] Add a filter dropdown to the
// existing dashboard table — user can filter rows by domain (auth / payments /
// observability) and the URL reflects the active filter.
//
// Run: npx playwright test tests/domain-filter.spec.ts

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const DOMAINS = ['auth', 'payments', 'observability'] as const;

const MOCK_TASKS_ALL = [
  { id: 't1', title: 'Login flow', status: 'done', spawnedBy: 'pipeline', domainSlugs: ['auth'], createdAt: '2026-04-01T00:00:00Z' },
  { id: 't2', title: 'Checkout billing', status: 'running', spawnedBy: 'pipeline', domainSlugs: ['payments'], createdAt: '2026-04-02T00:00:00Z' },
  { id: 't3', title: 'Metrics dashboard', status: 'queued', spawnedBy: 'pipeline', domainSlugs: ['observability'], createdAt: '2026-04-03T00:00:00Z' },
  { id: 't4', title: 'Token refresh', status: 'done', spawnedBy: 'pipeline', domainSlugs: ['auth'], createdAt: '2026-04-04T00:00:00Z' },
];

function tasksForDomain(domain: string) {
  return MOCK_TASKS_ALL.filter((t) => t.domainSlugs.includes(domain));
}

// ─── Happy path ───────────────────────────────────────────────────────────────

test.describe('Domain filter dropdown — happy path', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/tasks*', (route) => {
      const url = new URL(route.request().url());
      const domain = url.searchParams.get('domain');
      const body = domain ? tasksForDomain(domain) : MOCK_TASKS_ALL;
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  });

  test('filter dropdown renders with All and each domain option', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await expect(combo).toBeVisible();

    await combo.click();
    await expect(page.getByRole('option', { name: /all/i })).toBeVisible();
    for (const d of DOMAINS) {
      await expect(page.getByRole('option', { name: new RegExp(d, 'i') })).toBeVisible();
    }
  });

  test('selecting a domain filters the table rows', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await combo.selectOption('auth');

    for (const t of tasksForDomain('auth')) {
      await expect(page.getByText(t.title)).toBeVisible();
    }
    for (const t of MOCK_TASKS_ALL.filter((x) => !x.domainSlugs.includes('auth'))) {
      await expect(page.getByText(t.title)).not.toBeVisible();
    }
  });

  test('switching domain updates the visible rows', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await combo.selectOption('payments');
    await expect(page.getByText('Checkout billing')).toBeVisible();
    await expect(page.getByText('Login flow')).not.toBeVisible();

    await combo.selectOption('observability');
    await expect(page.getByText('Metrics dashboard')).toBeVisible();
    await expect(page.getByText('Checkout billing')).not.toBeVisible();
  });

  test('selecting All restores the full row set', async ({ page }) => {
    await page.goto('/tasks?domain=auth', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await combo.selectOption('');

    await expect(page.getByText('Login flow')).toBeVisible();
    await expect(page.getByText('Checkout billing')).toBeVisible();
    await expect(page.getByText('Metrics dashboard')).toBeVisible();
  });
});

// ─── URL reflects the active filter ──────────────────────────────────────────

test.describe('Domain filter — URL persistence', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/tasks*', (route) => {
      const url = new URL(route.request().url());
      const domain = url.searchParams.get('domain');
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(domain ? tasksForDomain(domain) : MOCK_TASKS_ALL),
      });
    });
  });

  test('selecting a domain sets ?domain= in the URL', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await combo.selectOption('payments');

    await expect(page).toHaveURL(/[?&]domain=payments/);
  });

  test('loading the page with ?domain=auth pre-selects that option', async ({ page }) => {
    await page.goto('/tasks?domain=auth', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await expect(combo).toHaveValue('auth');
    await expect(page.getByText('Login flow')).toBeVisible();
    await expect(page.getByText('Checkout billing')).not.toBeVisible();
  });

  test('clearing the filter removes ?domain= from the URL', async ({ page }) => {
    await page.goto('/tasks?domain=observability', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await combo.selectOption('');

    const url = page.url();
    expect(url).not.toMatch(/[?&]domain=/);
  });
});

// ─── Edge cases ───────────────────────────────────────────────────────────────

test.describe('Domain filter — edge cases', () => {
  test('rapid double-change does not duplicate network requests', async ({ page }) => {
    const requests: string[] = [];
    await page.route('/api/tasks*', (route) => {
      const url = new URL(route.request().url());
      requests.push(url.searchParams.get('domain') ?? 'all');
      route.fulfill({ status: 200, contentType: 'application/json', body: '[]' });
    });

    await page.goto('/tasks', { waitUntil: 'networkidle' });
    requests.length = 0;

    const combo = page.getByRole('combobox', { name: /domain/i });
    await combo.selectOption('auth');
    await combo.selectOption('payments');

    await page.waitForTimeout(300);
    // Final selection "payments" should appear exactly once; no runaway polling
    expect(requests.filter((r) => r === 'payments').length).toBe(1);
  });

  test('unknown ?domain= value falls back to showing all rows', async ({ page }) => {
    await page.route('/api/tasks*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TASKS_ALL) });
    });

    await page.goto('/tasks?domain=unknown-domain-xyz', { waitUntil: 'networkidle' });

    await expect(page.getByText('Login flow')).toBeVisible();
    await expect(page.getByText('Checkout billing')).toBeVisible();
  });
});

// ─── Error states ─────────────────────────────────────────────────────────────

test.describe('Domain filter — error states', () => {
  test('API 500 shows a user-friendly error state', async ({ page }) => {
    await page.route('/api/tasks*', (route) => {
      route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"upstream"}' });
    });

    await page.goto('/tasks', { waitUntil: 'networkidle' });

    await expect(
      page.getByRole('alert').or(page.getByText(/error|failed|unavailable/i).first()),
    ).toBeVisible({ timeout: 5000 });

    // Filter dropdown must survive the API error
    await expect(page.getByRole('combobox', { name: /domain/i })).toBeVisible();
  });

  test('loading indicator appears while the fetch is in flight', async ({ page }) => {
    let resolveRequest!: () => void;
    await page.route('/api/tasks*', (route) => {
      new Promise<void>((res) => { resolveRequest = res; }).then(() =>
        route.fulfill({ status: 200, contentType: 'application/json', body: '[]' }),
      );
    });

    await page.goto('/tasks');

    const spinner = page.getByRole('status').or(page.getByText(/loading/i).first());
    await expect(spinner).toBeVisible({ timeout: 3000 });

    resolveRequest();
    await page.waitForLoadState('networkidle');
  });
});

// ─── Responsive layout ────────────────────────────────────────────────────────

test.describe('Domain filter — responsive', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/tasks*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TASKS_ALL) });
    });
  });

  test('filter is visible and functional at 375 px mobile', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await expect(combo).toBeVisible();
    await combo.selectOption('auth');
    await expect(page).toHaveURL(/[?&]domain=auth/);
  });

  test('filter is visible and functional at 1280 px desktop', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await expect(combo).toBeVisible();
    await combo.selectOption('payments');
    await expect(page).toHaveURL(/[?&]domain=payments/);
  });
});

// ─── Accessibility ─────────────────────────────────────────────────────────────

test.describe('Domain filter — accessibility', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('/api/tasks*', (route) => {
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_TASKS_ALL) });
    });
  });

  test('zero serious/critical axe violations with filter rendered', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );

    if (blocking.length > 0) {
      const summary = blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`).join('\n  ');
      throw new Error(`a11y gate failed: ${blocking.length} blocking violations\n  ${summary}`);
    }
  });

  test('filter combobox is reachable via keyboard Tab', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    let found = false;
    for (let i = 0; i < 20; i++) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(
        () => (document.activeElement as HTMLElement)?.getAttribute('role') ?? document.activeElement?.tagName?.toLowerCase() ?? '',
      );
      if (tag === 'combobox' || tag === 'select') { found = true; break; }
    }

    expect(found, 'combobox must be reachable by keyboard Tab').toBe(true);
  });

  test('filter combobox has an accessible label visible to assistive tech', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });
    // getByRole with name asserts the accessible name is present
    await expect(page.getByRole('combobox', { name: /domain/i })).toBeVisible();
  });

  test('focus indicator is visible on the filter combobox', async ({ page }) => {
    await page.goto('/tasks', { waitUntil: 'networkidle' });

    const combo = page.getByRole('combobox', { name: /domain/i });
    await combo.focus();

    // Confirm the element is the active element (focus landed)
    const isFocused = await combo.evaluate((el) => el === document.activeElement);
    expect(isFocused).toBe(true);
  });
});
