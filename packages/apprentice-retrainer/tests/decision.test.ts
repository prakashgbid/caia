import { describe, expect, it } from 'vitest';
import {
  postTrainDecision,
  preTrainDecision,
  shouldRetrainGivenDelta
} from '../src/decision.js';
import type {
  DecisionInput,
  PostTrainDecisionInput
} from '../src/decision.js';
import type { RegistryEntry, RetrainerStateFile } from '../src/types.js';

function emptyState(): RetrainerStateFile {
  return {
    version: 1,
    generatedAt: '2026-05-06T00:00:00.000Z',
    lastSuccessfulTrain: null,
    lastCanaryPromotedAt: null,
    lastProductionPromotedAt: null,
    lastError: null,
    history: []
  };
}

function makeCanary(promotedAtIso: string): RegistryEntry {
  return {
    adapterName: 'qwen-c',
    adapterPath: '/a/qwen-c',
    metadataSha256: 'a'.repeat(64),
    configSha256: 'cfg',
    baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    baseModelOllamaTag: 'qwen2.5-coder:7b',
    status: 'canary',
    history: [],
    canaryPercent: 10,
    ollamaModelName: 'qwen2-5-coder-7b-canary-abc',
    registeredAt: promotedAtIso,
    promotedAt: promotedAtIso
  };
}

function defaults(overrides: Partial<DecisionInput> = {}): DecisionInput {
  return {
    state: emptyState(),
    currentCanary: undefined,
    currentProduction: undefined,
    nowMs: new Date('2026-05-06T02:00:00.000Z').getTime(),
    force: false,
    retrainThreshold: 500,
    retrainMaxAgeMs: 7 * 24 * 60 * 60 * 1000,
    canaryHoldDays: 3,
    ...overrides
  };
}

describe('preTrainDecision', () => {
  it('aggregates+trains when never trained and no canary', () => {
    expect(preTrainDecision(defaults()).kind).toBe('aggregate-and-train');
  });

  it('skips when last train is recent and no force', () => {
    const state = emptyState();
    state.lastSuccessfulTrain = {
      at: '2026-05-04T00:00:00.000Z',
      adapterPath: '/x',
      adapterName: 'x',
      corpusManifestSha256: 's',
      outcome: 'trained-and-canary-promoted'
    };
    const d = preTrainDecision(defaults({ state }));
    expect(d.kind).toBe('skip-no-delta');
  });

  it('aggregates+trains when last train is older than retrainMaxAge', () => {
    const state = emptyState();
    state.lastSuccessfulTrain = {
      at: '2026-04-15T00:00:00.000Z', // 3 weeks before nowMs
      adapterPath: '/x',
      adapterName: 'x',
      corpusManifestSha256: 's',
      outcome: 'trained-and-canary-promoted'
    };
    const d = preTrainDecision(defaults({ state }));
    expect(d.kind).toBe('aggregate-and-train');
  });

  it('aggregates+trains when force=true (no canary)', () => {
    const state = emptyState();
    state.lastSuccessfulTrain = {
      at: '2026-05-05T00:00:00.000Z',
      adapterPath: '/x',
      adapterName: 'x',
      corpusManifestSha256: 's',
      outcome: 'trained-and-canary-promoted'
    };
    const d = preTrainDecision(defaults({ state, force: true }));
    expect(d.kind).toBe('aggregate-and-train');
  });

  it('skips when canary still in soak window', () => {
    const canary = makeCanary('2026-05-05T00:00:00.000Z'); // 1 day old
    const d = preTrainDecision(defaults({ currentCanary: canary }));
    expect(d.kind).toBe('skip-canary-active');
  });

  it('skips when canary still in soak window even with force', () => {
    const canary = makeCanary('2026-05-05T00:00:00.000Z');
    const d = preTrainDecision(defaults({ currentCanary: canary, force: true }));
    expect(d.kind).toBe('skip-canary-active');
  });

  it('prompts operator when canary held >= canaryHoldDays', () => {
    const canary = makeCanary('2026-05-01T00:00:00.000Z'); // 5 days old
    const d = preTrainDecision(defaults({ currentCanary: canary }));
    expect(d.kind).toBe('prompt-operator-canary-held');
  });
});

describe('shouldRetrainGivenDelta', () => {
  it('always trains when forceOrAge=true', () => {
    expect(shouldRetrainGivenDelta(0, 500, true)).toBe(true);
  });

  it('trains at threshold', () => {
    expect(shouldRetrainGivenDelta(500, 500, false)).toBe(true);
    expect(shouldRetrainGivenDelta(499, 500, false)).toBe(false);
  });
});

describe('postTrainDecision', () => {
  function input(overrides: Partial<PostTrainDecisionInput> = {}): PostTrainDecisionInput {
    return {
      evalReport: undefined,
      evalWinRateGate: 0.6,
      ...overrides
    };
  }

  it('rejects when eval not available (no harness)', () => {
    const d = postTrainDecision(input());
    expect(d.kind).toBe('reject-no-eval');
  });

  it('rejects when winRate below gate', () => {
    const d = postTrainDecision(
      input({
        evalReport: { name: 'x', winRate: 0.5, decision: 'reject', regressionFlags: [] }
      })
    );
    expect(d.kind).toBe('reject-low-winrate');
  });

  it('rejects when regressions present even with high winRate', () => {
    const d = postTrainDecision(
      input({
        evalReport: { name: 'x', winRate: 0.9, decision: 'promote', regressionFlags: ['p1'] }
      })
    );
    expect(d.kind).toBe('reject-regressions');
  });

  it('promotes canary when winRate above gate AND no regressions', () => {
    const d = postTrainDecision(
      input({
        evalReport: { name: 'x', winRate: 0.7, decision: 'promote-canary', regressionFlags: [] }
      })
    );
    expect(d.kind).toBe('promote-canary');
  });

  it('promotes canary at exactly the gate (>= boundary clarification: < strict)', () => {
    const d = postTrainDecision(
      input({
        evalReport: { name: 'x', winRate: 0.6, decision: 'promote-canary', regressionFlags: [] }
      })
    );
    // 0.6 is NOT < 0.6 — so promote.
    expect(d.kind).toBe('promote-canary');
  });
});
