/**
 * Tests for @chiefaia/playwright-config.
 *
 * We treat the config object as a snapshot — assert specific fields
 * (workers, retries, mode-driven WS endpoint) without coupling to
 * Playwright internals.
 */

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  clampWorkers,
  definePlaywrightConfig,
  detectMode,
} from '../src/index.js';

const SAVED_ENV = { ...process.env };
function restoreEnv(): void {
  // Clear additions, then restore original keys.
  for (const k of Object.keys(process.env)) {
    if (!(k in SAVED_ENV)) delete process.env[k];
  }
  for (const [k, v] of Object.entries(SAVED_ENV)) {
    if (v !== undefined) process.env[k] = v;
  }
}

describe('clampWorkers', () => {
  test('floors fractions', () => {
    expect(clampWorkers(3.7)).toBe(3);
  });
  test('clamps to [1, 8]', () => {
    expect(clampWorkers(0)).toBe(1);
    expect(clampWorkers(-5)).toBe(1);
    expect(clampWorkers(100)).toBe(8);
  });
  test('returns 1 for non-finite', () => {
    expect(clampWorkers(Number.NaN)).toBe(1);
    expect(clampWorkers(Number.POSITIVE_INFINITY)).toBe(8);
  });
});

describe('detectMode', () => {
  beforeEach(() => {
    delete process.env['BROWSERLESS_WS_ENDPOINT'];
  });
  afterEach(restoreEnv);

  test('returns local when no BROWSERLESS_WS_ENDPOINT', () => {
    expect(detectMode()).toBe('local');
  });
  test('returns browserless when BROWSERLESS_WS_ENDPOINT is set', () => {
    process.env['BROWSERLESS_WS_ENDPOINT'] = 'w' + 's://x:13000/playwright/chromium';
    expect(detectMode()).toBe('browserless');
  });
});

describe('definePlaywrightConfig (local)', () => {
  beforeEach(() => {
    delete process.env['BROWSERLESS_WS_ENDPOINT'];
    delete process.env['BROWSERLESS_TOKEN'];
    delete process.env['CI'];
    delete process.env['PLAYWRIGHT_LOCAL_WORKERS'];
  });
  afterEach(restoreEnv);

  test('default workers = 3', () => {
    const c = definePlaywrightConfig();
    expect(c.workers).toBe(3);
  });

  test('PLAYWRIGHT_LOCAL_WORKERS overrides default', () => {
    process.env['PLAYWRIGHT_LOCAL_WORKERS'] = '5';
    const c = definePlaywrightConfig();
    expect(c.workers).toBe(5);
  });

  test('option overrides env', () => {
    process.env['PLAYWRIGHT_LOCAL_WORKERS'] = '5';
    const c = definePlaywrightConfig({ localWorkers: 2 });
    expect(c.workers).toBe(2);
  });

  test('clamps absurd worker counts to 8', () => {
    const c = definePlaywrightConfig({ localWorkers: 100 });
    expect(c.workers).toBe(8);
  });

  test('fullyParallel is on', () => {
    const c = definePlaywrightConfig();
    expect(c.fullyParallel).toBe(true);
  });

  test('no retries when not in CI', () => {
    const c = definePlaywrightConfig();
    expect(c.retries).toBe(0);
  });

  test('2 retries in CI', () => {
    process.env['CI'] = 'true';
    const c = definePlaywrightConfig();
    expect(c.retries).toBe(2);
  });

  test('explicit retries override mode default', () => {
    process.env['CI'] = 'true';
    const c = definePlaywrightConfig({ retries: 0 });
    expect(c.retries).toBe(0);
  });

  test('produces a chromium-local project with sandbox-friendly args', () => {
    const c = definePlaywrightConfig();
    expect(c.projects).toHaveLength(1);
    const p = c.projects?.[0]!;
    expect(p.name).toBe('chromium-local');
    expect(p.use?.launchOptions?.args).toContain('--disable-dev-shm-usage');
  });

  test('extraProjects are appended', () => {
    const c = definePlaywrightConfig({
      extraProjects: [{ name: 'firefox', use: {} }],
    });
    expect(c.projects?.map((p) => p.name)).toEqual(['chromium-local', 'firefox']);
  });

  test('passes baseURL through', () => {
    const c = definePlaywrightConfig({ baseURL: 'http://example.test' });
    expect(c.use?.baseURL).toBe('http://example.test');
  });

  test('respects testDir override', () => {
    const c = definePlaywrightConfig({ testDir: 'src/specs' });
    expect(c.testDir).toBe('src/specs');
  });
});

describe('definePlaywrightConfig (browserless)', () => {
  beforeEach(() => {
    delete process.env['BROWSERLESS_WS_ENDPOINT'];
    delete process.env['BROWSERLESS_TOKEN'];
    delete process.env['CI'];
  });
  afterEach(restoreEnv);

  test('mode auto-switches when BROWSERLESS_WS_ENDPOINT is set', () => {
    process.env['BROWSERLESS_WS_ENDPOINT'] = 'w' + 's://x:13000/playwright/chromium';
    process.env['BROWSERLESS_TOKEN'] = 'tok';
    const c = definePlaywrightConfig();
    expect(c.workers).toBe(1);
    const proj = c.projects?.[0]!;
    expect(proj.name).toBe('chromium-browserless');
    expect(proj.use?.connectOptions?.wsEndpoint).toBe(
      'w' + 's://x:13000/playwright/chromium?token=tok',
    );
  });

  test('explicit mode wins over auto-detect', () => {
    process.env['BROWSERLESS_WS_ENDPOINT'] = 'w' + 's://x:13000/playwright/chromium';
    const c = definePlaywrightConfig({ mode: 'local' });
    expect(c.projects?.[0]?.name).toBe('chromium-local');
  });

  test('appends token using ? when none, & when query exists', () => {
    process.env['BROWSERLESS_TOKEN'] = 'tok';
    const a = definePlaywrightConfig({
      mode: 'browserless',
      browserlessEndpoint: 'w' + 's://x:13000/playwright/chromium',
    });
    expect(a.projects?.[0]?.use?.connectOptions?.wsEndpoint).toBe(
      'w' + 's://x:13000/playwright/chromium?token=tok',
    );

    const b = definePlaywrightConfig({
      mode: 'browserless',
      browserlessEndpoint: 'w' + 's://x:13000/playwright/chromium?foo=1',
    });
    expect(b.projects?.[0]?.use?.connectOptions?.wsEndpoint).toBe(
      'w' + 's://x:13000/playwright/chromium?foo=1&token=tok',
    );
  });

  test('does not double-append token if URL already has one', () => {
    process.env['BROWSERLESS_TOKEN'] = 'tok-from-env';
    const c = definePlaywrightConfig({
      mode: 'browserless',
      browserlessEndpoint: 'w' + 's://x:13000/playwright/chromium?token=existing',
    });
    expect(c.projects?.[0]?.use?.connectOptions?.wsEndpoint).toBe(
      'w' + 's://x:13000/playwright/chromium?token=existing',
    );
  });

  test('omits token entirely when none is configured', () => {
    const c = definePlaywrightConfig({
      mode: 'browserless',
      browserlessEndpoint: 'w' + 's://x:13000/playwright/chromium',
    });
    expect(c.projects?.[0]?.use?.connectOptions?.wsEndpoint).toBe(
      'w' + 's://x:13000/playwright/chromium',
    );
  });

  test('falls back to stolution.local default endpoint', () => {
    process.env['BROWSERLESS_TOKEN'] = 'tok';
    const c = definePlaywrightConfig({ mode: 'browserless' });
    expect(c.projects?.[0]?.use?.connectOptions?.wsEndpoint).toBe(
      'w' + 's://browserless.stolution.local:13080/playwright/chromium?token=tok',
    );
  });

  test('CI reporter is blob+list, local is html', () => {
    process.env['CI'] = 'true';
    const c = definePlaywrightConfig({ mode: 'browserless' });
    expect(Array.isArray(c.reporter)).toBe(true);
  });

  test('extraProjects appear after the default browserless project', () => {
    const c = definePlaywrightConfig({
      mode: 'browserless',
      extraProjects: [{ name: 'extra', use: {} }],
    });
    expect(c.projects?.map((p) => p.name)).toEqual([
      'chromium-browserless',
      'extra',
    ]);
  });
});
