import { describe, it, expect } from 'vitest';

import {
  buildRunPlan,
  parsePlaywrightJson,
  countRequiredFailures,
  createStubPlaywrightAdapter,
} from '../src/agent.js';
import type { PlaywrightRunPlan, PlaywrightSpecResult, ProductionTarget } from '../src/types.js';

const target = (overrides: Partial<ProductionTarget> = {}): ProductionTarget => ({
  ticketId: 'T-100',
  projectId: 'P-1',
  productionUrl: 'https://app.example.com',
  packageName: '@caia/example',
  ...overrides,
});

const plan = (overrides: Partial<PlaywrightRunPlan> = {}): PlaywrightRunPlan => ({
  target: target(),
  specFiles: ['/tests/e2e/login.spec.ts'],
  mode: 'local',
  timeoutMs: 60_000,
  env: {},
  ...overrides,
});

describe('buildRunPlan', () => {
  it('defaults to local mode and 5-min timeout', () => {
    const previous = process.env['BROWSERLESS_WS_ENDPOINT'];
    delete process.env['BROWSERLESS_WS_ENDPOINT'];
    try {
      const p = buildRunPlan(target(), { specFiles: ['a.spec.ts'] });
      expect(p.mode).toBe('local');
      expect(p.timeoutMs).toBe(5 * 60 * 1000);
    } finally {
      if (previous !== undefined) process.env['BROWSERLESS_WS_ENDPOINT'] = previous;
    }
  });

  it('switches to browserless when WS endpoint is set', () => {
    const previous = process.env['BROWSERLESS_WS_ENDPOINT'];
    process.env['BROWSERLESS_WS_ENDPOINT'] = 'ws://test/x';
    try {
      const p = buildRunPlan(target(), { specFiles: ['a.spec.ts'] });
      expect(p.mode).toBe('browserless');
    } finally {
      if (previous === undefined) delete process.env['BROWSERLESS_WS_ENDPOINT'];
      else process.env['BROWSERLESS_WS_ENDPOINT'] = previous;
    }
  });

  it('honours mode override', () => {
    const p = buildRunPlan(target(), { specFiles: ['a.spec.ts'], mode: 'browserless' });
    expect(p.mode).toBe('browserless');
  });

  it('honours custom timeout', () => {
    const p = buildRunPlan(target(), { specFiles: ['a.spec.ts'], timeoutMs: 1234 });
    expect(p.timeoutMs).toBe(1234);
  });

  it('passes target labels through env', () => {
    const p = buildRunPlan(target({ ticketId: 'T-9' }), { specFiles: ['a.spec.ts'] });
    expect(p.env['CAIA_QA_ENGINEER_TICKET_ID']).toBe('T-9');
    expect(p.env['PLAYWRIGHT_BASE_URL']).toBe('https://app.example.com');
  });
});

describe('parsePlaywrightJson', () => {
  it('returns [] for malformed input', () => {
    expect(parsePlaywrightJson(null, plan())).toEqual([]);
    expect(parsePlaywrightJson({}, plan())).toEqual([]);
    expect(parsePlaywrightJson({ suites: 'x' }, plan())).toEqual([]);
  });

  it('parses a single passed spec', () => {
    const raw = {
      suites: [{
        title: 'login', file: 'login.spec.ts',
        specs: [{
          id: 's1', title: 'logs in', line: 10,
          tests: [{ results: [{ status: 'passed', duration: 12 }] }],
        }],
      }],
    };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs).toHaveLength(1);
    expect(specs[0]!.status).toBe('passed');
    expect(specs[0]!.durationMs).toBe(12);
    expect(specs[0]!.line).toBe(10);
  });

  it('maps Playwright timedOut to errored', () => {
    const raw = {
      suites: [{
        file: 'x.spec.ts',
        specs: [{ id: 's1', title: 'x',
          tests: [{ results: [{ status: 'timedOut', duration: 5 }] }] }],
      }],
    };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs[0]!.status).toBe('errored');
  });

  it('maps Playwright interrupted to errored', () => {
    const raw = { suites: [{ file: 'x.spec.ts', specs: [{ id: 's1', title: 'x',
      tests: [{ results: [{ status: 'interrupted', duration: 5 }] }] }] }] };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs[0]!.status).toBe('errored');
  });

  it('maps Playwright flaky to flaky', () => {
    const raw = { suites: [{ file: 'x.spec.ts', specs: [{ id: 's1', title: 'x',
      tests: [{ results: [{ status: 'flaky', duration: 5 }] }] }] }] };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs[0]!.status).toBe('flaky');
  });

  it('captures errorMessage from a failed result', () => {
    const raw = { suites: [{ file: 'x.spec.ts', specs: [{ id: 's1', title: 'x',
      tests: [{ results: [{ status: 'failed', duration: 5, error: { message: 'expected 200' } }] }] }] }] };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs[0]!.status).toBe('failed');
    expect(specs[0]!.errorMessage).toBe('expected 200');
  });

  it('marks specs as required by default when no label override', () => {
    const raw = { suites: [{ file: 'x.spec.ts', specs: [{ id: 's1', title: 'x',
      tests: [{ results: [{ status: 'passed', duration: 5 }] }] }] }] };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs[0]!.required).toBe(true);
  });

  it('respects required-specs label as a comma-separated whitelist', () => {
    const raw = { suites: [{ file: 'x.spec.ts',
      specs: [
        { id: 's1', title: 'x', tests: [{ results: [{ status: 'passed', duration: 1 }] }] },
        { id: 's2', title: 'y', tests: [{ results: [{ status: 'passed', duration: 1 }] }] },
      ] }] };
    const specs = parsePlaywrightJson(raw, plan({
      target: target({ labels: { 'required-specs': 's1' } }),
    }));
    expect(specs[0]!.required).toBe(true);
    expect(specs[1]!.required).toBe(false);
  });

  it('descends into nested suites', () => {
    const raw = { suites: [{ file: 'x.spec.ts', suites: [{ file: 'x.spec.ts',
      specs: [{ id: 's-nested', title: 'inner', tests: [{ results: [{ status: 'passed', duration: 1 }] }] }] }] }] };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs).toHaveLength(1);
    expect(specs[0]!.specId).toBe('s-nested');
  });

  it('treats skipped + passed mix as passed', () => {
    const raw = { suites: [{ file: 'x.spec.ts', specs: [{ id: 's1', title: 'x',
      tests: [{ results: [{ status: 'skipped', duration: 0 }, { status: 'passed', duration: 5 }] }] }] }] };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs[0]!.status).toBe('passed');
  });

  it('falls back to file::title for spec id when id is missing', () => {
    const raw = { suites: [{ file: 'x.spec.ts', specs: [{ title: 'no-id',
      tests: [{ results: [{ status: 'passed', duration: 1 }] }] }] }] };
    const specs = parsePlaywrightJson(raw, plan());
    expect(specs[0]!.specId).toBe('x.spec.ts::no-id');
  });
});

describe('countRequiredFailures', () => {
  const sp = (overrides: Partial<PlaywrightSpecResult> = {}): PlaywrightSpecResult => ({
    specId: 's1', title: 't', file: 'f', status: 'passed', durationMs: 0, required: true, ...overrides,
  });

  it('counts only required failed/errored', () => {
    expect(countRequiredFailures([
      sp({ status: 'failed', required: true }),
      sp({ status: 'failed', required: false }),
      sp({ status: 'errored', required: true }),
      sp({ status: 'passed', required: true }),
      sp({ status: 'skipped', required: true }),
      sp({ status: 'flaky', required: true }),
    ])).toBe(2);
  });

  it('returns 0 for an empty list', () => {
    expect(countRequiredFailures([])).toBe(0);
  });
});

describe('createStubPlaywrightAdapter', () => {
  it('returns the configured result on run()', async () => {
    const adapter = createStubPlaywrightAdapter({
      result: {
        status: 'passed', specs: [], requiredFailures: 0,
        totalDurationMs: 0, mode: 'local',
        startedAtIso: 'a', finishedAtIso: 'b',
      },
    });
    const out = await adapter.run(plan());
    expect(out.status).toBe('passed');
  });
});
