import { describe, it, expect } from 'vitest';

import {
  validateInProduction,
  decideVerdict,
  decideSeverity,
  buildRollbackRecommendation,
  summarisePlaywrightForLog,
  failedSpecIds,
} from '../src/api.js';
import { createStubPlaywrightAdapter } from '../src/agent.js';
import type {
  OutcomeStewardAdapter,
  OutcomeStewardCheck,
  PlaywrightRunResult,
  PlaywrightSpecResult,
  ProductionTarget,
  SpecStrategy,
  ValidateInProductionConfig,
} from '../src/types.js';
import { InvalidTransitionError, ProjectNotFoundError } from '@caia/state-machine';
import type {
  ProjectState,
  StateMachine,
  TransitionResult,
} from '@caia/state-machine';
import type { AttestationCell } from '@caia/outcome-steward';

const target = (overrides: Partial<ProductionTarget> = {}): ProductionTarget => ({
  ticketId: 'T-100',
  projectId: 'P-1',
  productionUrl: 'https://app.example.com',
  packageName: '@caia/example',
  ...overrides,
});

const playResult = (overrides: Partial<PlaywrightRunResult> = {}): PlaywrightRunResult => ({
  status: 'passed', specs: [], requiredFailures: 0,
  totalDurationMs: 10, mode: 'local',
  startedAtIso: '2026-05-25T00:00:00.000Z',
  finishedAtIso: '2026-05-25T00:00:01.000Z',
  ...overrides,
});

const sp = (overrides: Partial<PlaywrightSpecResult> = {}): PlaywrightSpecResult => ({
  specId: 's1', title: 't', file: 'f.spec.ts', status: 'failed', durationMs: 1, required: true, ...overrides,
});

const cell = (overrides: Partial<AttestationCell> = {}): AttestationCell => ({
  packageName: '@caia/example', solutionId: 'S-1', sliMetric: 'm1',
  status: 'red', latestValue: 0, threshold: 1, direction: 'gt',
  trend: 'down', trendSlopePerHour: -1, result: null, ...overrides,
});

const stewardCheck = (overrides: Partial<OutcomeStewardCheck> = {}): OutcomeStewardCheck => ({
  backend: 'present',
  matrix: { cells: new Map(), packages: [], solutions: [] },
  relevantCells: [],
  summary: { green: 0, yellow: 0, red: 0, noMetricDeclared: 0, noMetricStore: 0, unknown: 0 },
  verdict: 'all-green',
  ...overrides,
});

const stewardAdapter = (result: OutcomeStewardCheck): OutcomeStewardAdapter => ({
  async check() { return result; },
});

const specStrategy: SpecStrategy = {
  async resolveSpecs() {
    return {
      specFiles: ['/tests/e2e/login.spec.ts'],
      rewrittenSpecCount: 0,
      baseUrl: 'https://app.example.com',
      originalSpecDir: '/tests/e2e',
    };
  },
};

const mockBackend = {
  kind: 'mock',
  async health() { return { backend: 'present' as const }; },
  async query() { return { query: '', metric: null, samples: [], labels: {} }; },
};

const baseConfig = (overrides: Partial<ValidateInProductionConfig> = {}): ValidateInProductionConfig => ({
  playwright: createStubPlaywrightAdapter({ result: playResult() }),
  outcomeSteward: stewardAdapter(stewardCheck()),
  specStrategy,
  skipStateMachine: true,
  metricBackend: mockBackend,
  ...overrides,
});

describe('decideVerdict', () => {
  it('fails on Playwright failure regardless of steward', () => {
    expect(decideVerdict(playResult({ status: 'failed', requiredFailures: 1 }), stewardCheck())).toBe('failed');
  });

  it('fails on Playwright required-failure even if overall status is passed', () => {
    expect(decideVerdict(playResult({ requiredFailures: 1 }), stewardCheck())).toBe('failed');
  });

  it('passes when Playwright green and steward not provided', () => {
    expect(decideVerdict(playResult(), undefined)).toBe('passed');
  });

  it('passes on all-green steward verdict', () => {
    expect(decideVerdict(playResult(), stewardCheck({ verdict: 'all-green' }))).toBe('passed');
  });

  it('passes on no-metric-declared (graceful degradation)', () => {
    expect(decideVerdict(playResult(), stewardCheck({ verdict: 'no-metric-declared' }))).toBe('passed');
  });

  it('passes on no-metric-store (graceful degradation)', () => {
    expect(decideVerdict(playResult(), stewardCheck({ verdict: 'no-metric-store' }))).toBe('passed');
  });

  it('passes on degraded backend', () => {
    expect(decideVerdict(playResult(), stewardCheck({ verdict: 'degraded' }))).toBe('passed');
  });

  it('fails on red steward verdict', () => {
    expect(decideVerdict(playResult(), stewardCheck({ verdict: 'red',
      summary: { green: 0, yellow: 0, red: 1, noMetricDeclared: 0, noMetricStore: 0, unknown: 0 } }))).toBe('failed');
  });

  it('fails on mixed if any red cells', () => {
    expect(decideVerdict(playResult(), stewardCheck({ verdict: 'mixed',
      summary: { green: 1, yellow: 1, red: 1, noMetricDeclared: 0, noMetricStore: 0, unknown: 0 } }))).toBe('failed');
  });

  it('passes on mixed with no red cells', () => {
    expect(decideVerdict(playResult(), stewardCheck({ verdict: 'mixed',
      summary: { green: 2, yellow: 1, red: 0, noMetricDeclared: 0, noMetricStore: 0, unknown: 0 } }))).toBe('passed');
  });
});

describe('decideSeverity', () => {
  it('urgent on required Playwright failures', () => {
    expect(decideSeverity(playResult({ requiredFailures: 1, status: 'failed' }), undefined)).toBe('urgent');
  });
  it('urgent on red SLI cells', () => {
    expect(decideSeverity(playResult(), stewardCheck({ summary:
      { green: 0, yellow: 0, red: 1, noMetricDeclared: 0, noMetricStore: 0, unknown: 0 } }))).toBe('urgent');
  });
  it('wait on errored Playwright run', () => {
    expect(decideSeverity(playResult({ status: 'errored' }), undefined)).toBe('wait');
  });
  it('recommended otherwise', () => {
    expect(decideSeverity(playResult(), undefined)).toBe('recommended');
  });
});

describe('buildRollbackRecommendation', () => {
  it('lists failed spec ids as evidence', () => {
    const rec = buildRollbackRecommendation(
      target(),
      playResult({ status: 'failed', requiredFailures: 1,
        specs: [sp({ status: 'failed', required: true, specId: 's-login' })] }),
      undefined,
    );
    expect(rec.evidence.failedSpecs).toEqual(['s-login']);
    expect(rec.severity).toBe('urgent');
  });

  it('lists red cells as evidence', () => {
    const rec = buildRollbackRecommendation(
      target(),
      playResult(),
      stewardCheck({
        relevantCells: [cell({ status: 'red', sliMetric: 'lat_p95' })],
        summary: { green: 0, yellow: 0, red: 1, noMetricDeclared: 0, noMetricStore: 0, unknown: 0 },
        verdict: 'red',
      }),
    );
    expect(rec.evidence.redCells).toEqual(['@caia/example::S-1::lat_p95']);
    expect(rec.severity).toBe('urgent');
  });

  it('emits a wait severity on errored Playwright with steps to re-run', () => {
    const rec = buildRollbackRecommendation(
      target(),
      playResult({ status: 'errored' }),
      undefined,
    );
    expect(rec.severity).toBe('wait');
    expect(rec.steps.some((s) => s.toLowerCase().includes('re-run'))).toBe(true);
  });

  it('includes a devops-runtime rollback step on urgent', () => {
    const rec = buildRollbackRecommendation(
      target(),
      playResult({ status: 'failed', requiredFailures: 1,
        specs: [sp({ status: 'failed', required: true })] }),
      undefined,
    );
    expect(rec.steps.some((s) => s.includes('devops-runtime'))).toBe(true);
  });

  it('truncates large evidence lists in the steps blob', () => {
    const manySpecs: PlaywrightSpecResult[] = [];
    for (let i = 0; i < 12; i++) {
      manySpecs.push(sp({ specId: `s-${i}`, status: 'failed', required: true }));
    }
    const rec = buildRollbackRecommendation(
      target(),
      playResult({ status: 'failed', requiredFailures: manySpecs.length, specs: manySpecs }),
      undefined,
    );
    const stepBlob = rec.steps.join('\n');
    expect(stepBlob).toMatch(/\(\+7 more\)/);
  });
});

describe('summarisePlaywrightForLog + failedSpecIds', () => {
  it('summarises pass/fail counts', () => {
    const s = summarisePlaywrightForLog(playResult({ status: 'failed', requiredFailures: 2, totalDurationMs: 99 }));
    expect(s).toContain('status=failed');
    expect(s).toContain('requiredFailures=2');
  });

  it('returns only failed + errored spec ids', () => {
    const ids = failedSpecIds([
      sp({ specId: 'a', status: 'passed' }),
      sp({ specId: 'b', status: 'failed' }),
      sp({ specId: 'c', status: 'errored' }),
      sp({ specId: 'd', status: 'flaky' }),
    ]);
    expect(ids).toEqual(['b', 'c']);
  });
});

// ─── State-machine integration ──────────────────────────────────────────────

interface StubSmOpts {
  status?: ProjectState;
  transitionResult?: TransitionResult;
  transitionError?: unknown;
  notFound?: boolean;
  getProjectThrows?: Error;
}

function makeStubSm(opts: StubSmOpts): StateMachine {
  return {
    async getProject(_id: string) {
      if (opts.getProjectThrows) throw opts.getProjectThrows;
      if (opts.notFound) return null;
      return { id: _id, status: opts.status ?? ('deployed' as ProjectState), version: 5 } as never;
    },
    async transition(projectId: string, toState: ProjectState) {
      if (opts.transitionError) throw opts.transitionError;
      const r: TransitionResult = opts.transitionResult ?? {
        applied: true, projectId, fromState: opts.status ?? ('deployed' as ProjectState), toState,
        newVersion: 6, historyId: 'h-1', payloadHash: 'x', retries: 0,
      };
      return r;
    },
  } as unknown as StateMachine;
}

describe('validateInProduction state-machine driver', () => {
  it('drives deployed -> verified on pass', async () => {
    const sm = makeStubSm({});
    const r = await validateInProduction(target(), baseConfig({
      skipStateMachine: false, stateMachine: sm,
    }));
    expect(r.status).toBe('passed');
    expect(r.transition?.toState).toBe('verified');
    expect(r.transition?.applied).toBe(true);
  });

  it('drives deployed -> verify-failed on fail', async () => {
    const sm = makeStubSm({});
    const r = await validateInProduction(target(), baseConfig({
      skipStateMachine: false, stateMachine: sm,
      playwright: createStubPlaywrightAdapter({ result: playResult({
        status: 'failed', requiredFailures: 1,
        specs: [sp({ status: 'failed', required: true })],
      }) }),
    }));
    expect(r.status).toBe('failed');
    expect(r.transition?.toState).toBe('verify-failed');
    expect(r.rollbackRecommendation?.severity).toBe('urgent');
  });

  it('returns transition error when project not found', async () => {
    const sm = makeStubSm({ notFound: true });
    const r = await validateInProduction(target(), baseConfig({
      skipStateMachine: false, stateMachine: sm,
    }));
    expect(r.transition?.applied).toBe(false);
    expect(r.transition?.reason).toMatch(/not found/);
  });

  it('returns transition error when getProject throws', async () => {
    const sm = makeStubSm({ getProjectThrows: new Error('db down') });
    const r = await validateInProduction(target(), baseConfig({
      skipStateMachine: false, stateMachine: sm,
    }));
    expect(r.transition?.applied).toBe(false);
    expect(r.transition?.reason).toMatch(/getProject failed/);
  });

  it('handles InvalidTransitionError gracefully', async () => {
    const sm = makeStubSm({
      transitionError: new InvalidTransitionError('deployed' as ProjectState, 'verified' as ProjectState, 'illegal'),
    });
    const r = await validateInProduction(target(), baseConfig({
      skipStateMachine: false, stateMachine: sm,
    }));
    expect(r.transition?.reason).toMatch(/invalid-transition/);
  });

  it('handles ProjectNotFoundError gracefully', async () => {
    const sm = makeStubSm({ transitionError: new ProjectNotFoundError('P-1') });
    const r = await validateInProduction(target(), baseConfig({
      skipStateMachine: false, stateMachine: sm,
    }));
    expect(r.transition?.reason).toMatch(/project-not-found/);
  });

  it('skips state machine when skipStateMachine=true', async () => {
    const r = await validateInProduction(target(), baseConfig({ skipStateMachine: true }));
    expect(r.transition).toBeUndefined();
  });
});

describe('validateInProduction skips outcome-steward when no metric backend', () => {
  it('passes without steward call when metricBackend absent', async () => {
    const r = await validateInProduction(target(), {
      ...baseConfig(),
      metricBackend: undefined as never,
    });
    expect(r.status).toBe('passed');
    expect(r.outcomeSteward).toBeUndefined();
  });
});
