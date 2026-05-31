/**
 * Integration test — gated by CAIA_QA_ENGINEER_LIVE=1.
 *
 * Hits a real production-style URL (default https://example.com — the
 * IANA reserved example domain that is guaranteed-stable). The default
 * vitest suite skips this entirely to preserve True-Zero in CI.
 *
 * Run with:
 *
 *   CAIA_QA_ENGINEER_LIVE=1 pnpm -F @caia/qa-engineer test
 *   CAIA_QA_ENGINEER_LIVE=1 CAIA_QA_ENGINEER_LIVE_URL=https://app.example.com \
 *     pnpm -F @caia/qa-engineer test
 *
 * What this exercises:
 *   - Spec resolution against an empty spec dir (we do NOT spawn
 *     Playwright in the integration test — too heavyweight; instead the
 *     test confirms the strategy + adapter + outcome-steward stub work
 *     end-to-end against a live HTTP endpoint via a thin verification
 *     fetch, then exercises validateInProduction's pass path with a
 *     stub Playwright adapter representing the result of a real run).
 */

import { describe, it, expect } from 'vitest';

import { validateInProduction } from '../src/api.js';
import { createStubPlaywrightAdapter } from '../src/agent.js';
import { createDefaultSpecStrategy } from '../src/test-strategy.js';
import type {
  OutcomeStewardAdapter,
  OutcomeStewardCheck,
  PlaywrightRunResult,
  ProductionTarget,
} from '../src/types.js';

const LIVE = process.env['CAIA_QA_ENGINEER_LIVE'] === '1';
const LIVE_URL = process.env['CAIA_QA_ENGINEER_LIVE_URL'] ?? 'https://example.com';

const noopSteward: OutcomeStewardAdapter = {
  async check(): Promise<OutcomeStewardCheck> {
    return {
      backend: 'absent',
      matrix: { cells: new Map(), packages: [], solutions: [] },
      relevantCells: [],
      summary: { green: 0, yellow: 0, red: 0, noMetricDeclared: 0, noMetricStore: 1, unknown: 0 },
      verdict: 'no-metric-store',
    };
  },
};

const passingPlay: PlaywrightRunResult = {
  status: 'passed', specs: [], requiredFailures: 0,
  totalDurationMs: 1, mode: 'local',
  startedAtIso: '2026-05-25T00:00:00.000Z',
  finishedAtIso: '2026-05-25T00:00:01.000Z',
};

const target: ProductionTarget = {
  ticketId: 'T-INTEG',
  projectId: 'P-INTEG',
  productionUrl: LIVE_URL,
  packageName: '@caia/integration-canary',
};

(LIVE ? describe : describe.skip)('integration: validateInProduction against a real URL', () => {
  it('verifies the production URL is reachable', async () => {
    // The fetch is a sanity check that the URL responds with 200 — we
    // don't want to silently pass while pointing at a dead URL. We
    // tolerate any 2xx/3xx.
    const r = await fetch(LIVE_URL, { method: 'GET' });
    expect(r.status).toBeGreaterThanOrEqual(200);
    expect(r.status).toBeLessThan(400);
  }, 15_000);

  it('runs validateInProduction end-to-end with no-metric-store steward', async () => {
    const strategy = createDefaultSpecStrategy({
      resolveSpecDir: () => '/tmp/caia-qa-engineer-empty',
    });
    const result = await validateInProduction(target, {
      playwright: createStubPlaywrightAdapter({ result: passingPlay }),
      outcomeSteward: noopSteward,
      specStrategy: strategy,
      skipStateMachine: true,
      metricBackend: {
        kind: 'null',
        async health() { return { backend: 'absent' as const }; },
        async query() { return { query: '', metric: null, samples: [], labels: {} }; },
      },
    });

    expect(result.status).toBe('passed');
    expect(result.productionUrl).toBe(LIVE_URL);
    expect(result.outcomeSteward?.verdict).toBe('no-metric-store');
  }, 30_000);
});
