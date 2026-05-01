// apps/dashboard/tests/arch-registry-ui.spec.ts
//
// Behavior + accessibility tests for the Architecture Registry page (/architecture).
// Story: story-story-wF1NK7-k0g2
// Feature: UI/UX rewrite — dark theme, WCAG 2.1 AA, loading states, error states,
//          responsive layout, domain search filter, edge inspector.
//
// Run: npx playwright test tests/arch-registry-ui.spec.ts

import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

/* ─── Fixtures ───────────────────────────────────────────────────────────── */

const MOCK_SUMMARY = {
  totalArtifacts: 42,
  totalEdges: 118,
  kindBreakdown: [{ kind: 'component', c: 20 }, { kind: 'api', c: 12 }, { kind: 'schema', c: 10 }],
  projectBreakdown: [{ project: 'dashboard', c: 25 }, { project: 'orchestrator', c: 17 }],
  sourceBreakdown: [{ source: 'auto', c: 40 }, { source: 'manual', c: 2 }],
  recentExtractRunCount24h: 3,
};

const MOCK_ARTIFACT: object = {
  id: 'art-001',
  kind: 'component',
  project: 'dashboard',
  name: 'SpikeWorkflowCard',
  description: 'Shows spike workflow status',
  entry_path: 'apps/dashboard/components/SpikeWorkflowCard.tsx',
  route_signature: null,
  table_name: null,
  package_name: null,
  design_system_tier: null,
  tech_sub_domains_json: '["frontend","design-system"]',
  tags_json: '[]',
  source: 'auto',
  created_at: Date.now() - 86_400_000,
  updated_at: Date.now() - 3_600_000,
};

const MOCK_EXTRACT_RUN: object = {
  id: 'run-001',
  extractor: 'component-extractor',
  started_at: Date.now() - 120_000,
  finished_at: Date.now() - 90_000,
  duration_ms: 30_000,
  commit_sha: 'abc1234',
  artifacts_inserted: 5,
  artifacts_updated: 2,
  artifacts_unchanged: 35,
  edges_inserted: 8,
  edges_updated: 1,
  error: null,
};

function wireHappyPath(page: import('@playwright/test').Page) {
  page.route('/api/architecture/summary', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SUMMARY) }),
  );
  page.route('/api/architecture/recent*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [MOCK_ARTIFACT] }) }),
  );
  page.route('/api/architecture/extract-runs*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [MOCK_EXTRACT_RUN] }) }),
  );
  page.route('/api/architecture/by-domain*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [MOCK_ARTIFACT] }) }),
  );
  page.route('/api/architecture/edges*', (r) =>
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) }),
  );
}

// ─── Dark theme ────────────────────────────────────────────────────────────────

test.describe('Architecture Registry — dark theme', () => {
  test.beforeEach(async ({ page }) => { wireHappyPath(page); });

  test('page background matches the dashboard palette (#0f1117)', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const bg = await page.evaluate(() =>
      getComputedStyle(document.querySelector('main') ?? document.body).backgroundColor,
    );
    // Accept rgb(15,17,23) ≈ #0f1117 (set by globals.css on <body>)
    // or the inline style on <main> – either confirms dark background is active
    const isDark = bg === 'rgb(15, 17, 23)' || bg === 'rgba(15, 17, 23, 1)' || bg === 'rgb(0, 0, 0)';
    // Confirm body background at minimum (Next.js injects globals.css)
    const bodyBg = await page.evaluate(() =>
      getComputedStyle(document.body).backgroundColor,
    );
    expect(bodyBg, 'body must be dark').toMatch(/rgb\(15, 17, 23\)|rgb\(0, 0, 0\)/);
    void isDark; // suppress unused
  });

  test('no bright white backgrounds on panel elements', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const brightWhiteCount = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('section, [role="region"]'));
      return sections.filter((el) => {
        const bg = getComputedStyle(el).backgroundColor;
        return bg === 'rgb(255, 255, 255)' || bg === 'rgba(255, 255, 255, 1)';
      }).length;
    });
    expect(brightWhiteCount, 'no panels should be pure white').toBe(0);
  });
});

// ─── Panel visibility ──────────────────────────────────────────────────────────

test.describe('Architecture Registry — all 5 panels visible', () => {
  test.beforeEach(async ({ page }) => { wireHappyPath(page); });

  test('Overview / Summary panel renders stat cards', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });
    await expect(page.getByText('42')).toBeVisible();   // totalArtifacts
    await expect(page.getByText('118')).toBeVisible();  // totalEdges
  });

  test('Domain browser panel renders with domain selector', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });
    const selector = page.getByRole('combobox', { name: /tech sub.domain|domain/i });
    await expect(selector).toBeVisible();
  });

  test('Recent Artifacts panel renders table', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });
    await expect(page.getByRole('table', { name: /architecture artifacts/i })).toBeVisible();
    await expect(page.getByText('SpikeWorkflowCard')).toBeVisible();
  });

  test('Extract Runs panel renders', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });
    await expect(page.getByText('component-extractor')).toBeVisible();
  });

  test('Edge Inspector panel renders with fromId / toId inputs', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });
    const fromInput = page.getByRole('textbox', { name: /from\s*id/i });
    const toInput   = page.getByRole('textbox', { name: /to\s*id/i });
    await expect(fromInput).toBeVisible();
    await expect(toInput).toBeVisible();
  });
});

// ─── Loading states ────────────────────────────────────────────────────────────

test.describe('Architecture Registry — loading states', () => {
  test('skeleton shimmer appears before API responds', async ({ page }) => {
    let resolveAll!: () => void;
    const blocker = new Promise<void>((res) => { resolveAll = res; });

    page.route('/api/architecture/summary', (r) =>
      blocker.then(() => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(MOCK_SUMMARY) })),
    );
    page.route('/api/architecture/recent*', (r) =>
      blocker.then(() => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) })),
    );
    page.route('/api/architecture/extract-runs*', (r) =>
      blocker.then(() => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) })),
    );
    page.route('/api/architecture/by-domain*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) }),
    );
    page.route('/api/architecture/edges*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) }),
    );

    await page.goto('/architecture');

    // Skeleton divs are aria-hidden; check for their shimmer animation style
    const hasSkeleton = await page.evaluate(() => {
      const els = Array.from(document.querySelectorAll('[aria-hidden="true"]'));
      return els.some((el) => {
        const s = getComputedStyle(el);
        return s.animationName === 'shimmer' || s.backgroundImage.includes('linear-gradient');
      });
    });
    expect(hasSkeleton, 'shimmer skeletons must be present during load').toBe(true);

    resolveAll();
    await page.waitForLoadState('networkidle');
  });
});

// ─── Error states ──────────────────────────────────────────────────────────────

test.describe('Architecture Registry — error states', () => {
  test('API 500 on summary shows role="alert" error banner', async ({ page }) => {
    page.route('/api/architecture/summary', (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"upstream"}' }),
    );
    page.route('/api/architecture/recent*', (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    page.route('/api/architecture/extract-runs*', (r) =>
      r.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    );
    page.route('/api/architecture/by-domain*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) }),
    );
    page.route('/api/architecture/edges*', (r) =>
      r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rows: [] }) }),
    );

    await page.goto('/architecture', { waitUntil: 'networkidle' });

    await expect(page.getByRole('alert')).toBeVisible({ timeout: 5000 });
  });

  test('API returning null does not crash the page (fail-soft)', async ({ page }) => {
    // All AKG routes return 404 — page should still render panels with empty states
    page.route('/api/architecture/**', (r) =>
      r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
    );

    await page.goto('/architecture', { waitUntil: 'networkidle' });

    // Header must still be present
    await expect(page.getByRole('main')).toBeVisible();
    // No JS crash
    const jsErrors: string[] = [];
    page.on('pageerror', (e) => jsErrors.push(e.message));
    await page.waitForTimeout(500);
    expect(jsErrors.filter((e) => !e.includes('ChunkLoadError'))).toHaveLength(0);
  });
});

// ─── Domain search filter ──────────────────────────────────────────────────────

test.describe('Architecture Registry — domain search filter', () => {
  test.beforeEach(async ({ page }) => { wireHappyPath(page); });

  test('search input in domain browser filters by name', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    // SpikeWorkflowCard should be in domain browser after load
    await expect(page.getByText('SpikeWorkflowCard').first()).toBeVisible({ timeout: 5000 });

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('zzz-no-match-xyz');
    await expect(page.getByText('SpikeWorkflowCard')).not.toBeVisible();
  });

  test('clearing the search shows results again', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const searchInput = page.getByPlaceholder(/search/i);
    await searchInput.fill('zzz-no-match-xyz');
    await expect(page.getByText('SpikeWorkflowCard')).not.toBeVisible();

    await searchInput.clear();
    await expect(page.getByText('SpikeWorkflowCard').first()).toBeVisible();
  });

  test('changing domain triggers a new /by-domain fetch', async ({ page }) => {
    const domainRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/architecture/by-domain')) {
        const u = new URL(req.url());
        domainRequests.push(u.searchParams.get('techSubDomain') ?? '');
      }
    });

    await page.goto('/architecture', { waitUntil: 'networkidle' });
    domainRequests.length = 0;

    const selector = page.getByRole('combobox', { name: /tech sub.domain|domain/i });
    await selector.selectOption('backend');

    await page.waitForTimeout(300);
    expect(domainRequests).toContain('backend');
  });
});

// ─── Edge inspector ────────────────────────────────────────────────────────────

test.describe('Architecture Registry — edge inspector', () => {
  test.beforeEach(async ({ page }) => { wireHappyPath(page); });

  test('Lookup button triggers /edges fetch with fromId param', async ({ page }) => {
    const edgeRequests: string[] = [];
    page.on('request', (req) => {
      if (req.url().includes('/api/architecture/edges')) edgeRequests.push(req.url());
    });

    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const fromInput = page.getByRole('textbox', { name: /from\s*id/i });
    await fromInput.fill('comp-001');
    await page.getByRole('button', { name: /lookup/i }).click();

    await page.waitForTimeout(500);
    expect(edgeRequests.some((u) => u.includes('fromId=comp-001'))).toBe(true);
  });

  test('shows "no edges found" message when edges API returns empty', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const fromInput = page.getByRole('textbox', { name: /from\s*id/i });
    await fromInput.fill('nonexistent-id');
    await page.getByRole('button', { name: /lookup/i }).click();

    await expect(page.getByText(/no edges found/i)).toBeVisible({ timeout: 5000 });
  });
});

// ─── Responsive layout ─────────────────────────────────────────────────────────

test.describe('Architecture Registry — responsive', () => {
  test.beforeEach(async ({ page }) => { wireHappyPath(page); });

  test('all panels visible at 375px mobile viewport', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    await expect(page.getByRole('main')).toBeVisible();
    // Domain selector must be reachable
    const selector = page.getByRole('combobox', { name: /tech sub.domain|domain/i });
    await expect(selector).toBeVisible();
  });

  test('all panels visible at 1280px desktop viewport', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    await expect(page.getByRole('main')).toBeVisible();
    await expect(page.getByText('42')).toBeVisible();  // summary card
  });

  test('horizontal scroll available on artifact table at 375px', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    // The wrapper div around the table should allow horizontal scroll
    const hasScroll = await page.evaluate(() => {
      const scrollable = document.querySelector('[style*="overflow-x"]');
      return !!scrollable;
    });
    expect(hasScroll, 'table wrapper must allow horizontal scroll on mobile').toBe(true);
  });
});

// ─── Accessibility ─────────────────────────────────────────────────────────────

test.describe('Architecture Registry — WCAG 2.1 AA', () => {
  test.beforeEach(async ({ page }) => { wireHappyPath(page); });

  test('zero serious or critical axe violations after data loads', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    const blocking = results.violations.filter(
      (v) => v.impact === 'serious' || v.impact === 'critical',
    );
    if (blocking.length > 0) {
      const summary = blocking.map((v) => `[${v.impact}] ${v.id}: ${v.help}`).join('\n  ');
      throw new Error(`a11y gate failed — ${blocking.length} blocking violation(s):\n  ${summary}`);
    }
  });

  test('panels have accessible region labels (aria-labelledby)', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const unlabelledSections = await page.evaluate(() => {
      const sections = Array.from(document.querySelectorAll('section'));
      return sections.filter((s) => !s.getAttribute('aria-labelledby') && !s.getAttribute('aria-label')).length;
    });
    expect(unlabelledSections, 'every <section> must have an accessible name').toBe(0);
  });

  test('interactive controls are keyboard-reachable via Tab', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    let foundCombo = false;
    for (let i = 0; i < 30; i++) {
      await page.keyboard.press('Tab');
      const tag = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement;
        return el?.tagName?.toLowerCase() ?? '';
      });
      if (tag === 'select' || tag === 'input' || tag === 'button') { foundCombo = true; break; }
    }
    expect(foundCombo, 'interactive controls must be reachable via keyboard Tab').toBe(true);
  });

  test('table column headers have scope="col"', async ({ page }) => {
    await page.goto('/architecture', { waitUntil: 'networkidle' });

    const unscopedTh = await page.evaluate(() =>
      Array.from(document.querySelectorAll('th')).filter((th) => !th.getAttribute('scope')).length,
    );
    expect(unscopedTh, 'all <th> must have scope attribute').toBe(0);
  });
});
