import { describe, expect, it } from 'vitest';

import {
  DefaultFsmDriver,
  STEWARD_GATE_ORDINAL,
  decideTransition,
  evaluateForwardChain,
} from '../src/fsm.js';
import { DEFAULT_FRESHNESS_HOURS } from '../src/types.js';
import type {
  StewardAttestation,
  StewardName,
} from '../src/types.js';

const NOW = new Date('2026-05-24T12:00:00Z');
const FRESH: Record<StewardName, number> = {
  deploy: DEFAULT_FRESHNESS_HOURS.deploy,
  usage: DEFAULT_FRESHNESS_HOURS.usage,
  activation: DEFAULT_FRESHNESS_HOURS.activation,
  outcome: DEFAULT_FRESHNESS_HOURS.outcome,
};

function att(
  steward: StewardName,
  status: StewardAttestation['status'],
  observedAt: Date = NOW,
): StewardAttestation {
  return { steward, solutionId: 'sln-1', status, observedAt: observedAt.toISOString() };
}

function blank(): Record<StewardName, StewardAttestation | null> {
  return {
    deploy: null,
    usage: null,
    activation: null,
    outcome: null,
  };
}

describe('STEWARD_GATE_ORDINAL — ADR-063 4-steward strict', () => {
  it('maps stewards to their forward-chain gate index, outcome at 9', () => {
    expect(STEWARD_GATE_ORDINAL.deploy).toBeGreaterThan(0);
    expect(STEWARD_GATE_ORDINAL.outcome).toBe(9);
    expect(STEWARD_GATE_ORDINAL.usage).toBeGreaterThan(STEWARD_GATE_ORDINAL.deploy);
    expect(STEWARD_GATE_ORDINAL.activation).toBeGreaterThan(STEWARD_GATE_ORDINAL.usage);
    expect(STEWARD_GATE_ORDINAL.outcome).toBeGreaterThan(STEWARD_GATE_ORDINAL.activation);
  });
  it('contains exactly 4 keys (no future-incoming)', () => {
    expect(Object.keys(STEWARD_GATE_ORDINAL).sort()).toEqual([
      'activation',
      'deploy',
      'outcome',
      'usage',
    ]);
  });
});

describe('evaluateForwardChain', () => {
  it('returns plan-approved with all-null attestations', () => {
    const ev = evaluateForwardChain(blank(), FRESH, NOW);
    expect(ev.highestForwardState).toBe('plan-approved');
    expect(ev.anyRed).toBe(false);
    expect(ev.anyStale).toBe(false);
  });

  it('advances past plan-approved when any attestation is observed', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'green');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.perStewardPass.deploy).toBe(true);
    expect(['pr-merged', 'deployed']).toContain(ev.highestForwardState);
  });

  it('reaches deployed once deploy is green and fresh', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'green');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.highestForwardState).toBe('deployed');
  });

  it('reaches built-into-active-app when deploy + usage are green', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'green');
    rows.usage = att('usage', 'green');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.highestForwardState).toBe('built-into-active-app');
  });

  it('reaches called-in-test with deploy+usage+activation green', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'green');
    rows.usage = att('usage', 'green');
    rows.activation = att('activation', 'green');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.highestForwardState).toBe('called-in-test');
  });

  it('reaches producing-metrics with all 4 stewards green AND fresh (ADR-063)', () => {
    const rows: Record<StewardName, StewardAttestation | null> = {
      deploy: att('deploy', 'green'),
      usage: att('usage', 'green'),
      activation: att('activation', 'green'),
      outcome: att('outcome', 'green'),
    };
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.highestForwardState).toBe('producing-metrics');
    expect(ev.anyRed).toBe(false);
    expect(ev.anyStale).toBe(false);
  });

  it('flags anyRed when any steward is red', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'red');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.anyRed).toBe(true);
    expect(ev.trigger).toContain('deploy.red');
  });

  it('flags anyStale when an attestation is older than the freshness window', () => {
    const rows = blank();
    rows.deploy = att(
      'deploy',
      'green',
      new Date(NOW.getTime() - DEFAULT_FRESHNESS_HOURS.deploy * 3_600_000 - 60_000),
    );
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.anyStale).toBe(true);
    expect(ev.trigger).toContain('deploy.stale');
    expect(ev.perStewardPass.deploy).toBe(false);
  });

  it('blocks producing-metrics if one steward is stale even if green', () => {
    const rows: Record<StewardName, StewardAttestation | null> = {
      deploy: att('deploy', 'green'),
      usage: att('usage', 'green'),
      activation: att('activation', 'green'),
      outcome: att('outcome', 'green', new Date(NOW.getTime() - 10 * 24 * 3_600_000)),
    };
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    expect(ev.highestForwardState).not.toBe('producing-metrics');
  });
});

describe('decideTransition', () => {
  it('keeps terminal states sticky', () => {
    const d = decideTransition({
      currentState: 'sunset',
      evaluation: evaluateForwardChain(blank(), FRESH, NOW),
      consecutiveGreensAcrossAllStewards: 999,
      degradedClearThreshold: 3,
    });
    expect(d.newState).toBe('sunset');
    expect(d.trigger).toBe('terminal');
  });

  it('drifts to degraded on any red', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'red');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    const d = decideTransition({
      currentState: 'deployed',
      evaluation: ev,
      consecutiveGreensAcrossAllStewards: 0,
      degradedClearThreshold: 3,
    });
    expect(d.newState).toBe('degraded');
    expect(d.isDrift).toBe(true);
  });

  it('stays sticky-degraded if greens have not yet crossed threshold', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'green');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    const d = decideTransition({
      currentState: 'degraded',
      evaluation: ev,
      consecutiveGreensAcrossAllStewards: 1,
      degradedClearThreshold: 3,
    });
    expect(d.newState).toBe('degraded');
    expect(d.trigger).toContain('degraded-sticky');
  });

  it('clears degraded when consecutive greens crosses threshold', () => {
    const rows: Record<StewardName, StewardAttestation | null> = {
      deploy: att('deploy', 'green'),
      usage: att('usage', 'green'),
      activation: att('activation', 'green'),
      outcome: att('outcome', 'green'),
    };
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    const d = decideTransition({
      currentState: 'degraded',
      evaluation: ev,
      consecutiveGreensAcrossAllStewards: 5,
      degradedClearThreshold: 3,
    });
    expect(d.newState).toBe('producing-metrics');
    expect(d.trigger).toContain('degraded-cleared');
  });

  it('advances forward when evaluation ordinal exceeds current ordinal', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'green');
    rows.usage = att('usage', 'green');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    const d = decideTransition({
      currentState: 'deployed',
      evaluation: ev,
      consecutiveGreensAcrossAllStewards: 2,
      degradedClearThreshold: 3,
    });
    expect(d.newState).toBe('built-into-active-app');
    expect(d.isRegression).toBe(false);
  });

  it('regresses to degraded if eval ordinal is BELOW current ordinal', () => {
    const ev = evaluateForwardChain(blank(), FRESH, NOW);
    const d = decideTransition({
      currentState: 'producing-metrics',
      evaluation: ev,
      consecutiveGreensAcrossAllStewards: 0,
      degradedClearThreshold: 3,
    });
    expect(d.newState).toBe('degraded');
    expect(d.isRegression).toBe(true);
    expect(d.trigger).toContain('regression-detected');
  });

  it('returns no-change when ordinal matches', () => {
    const rows = blank();
    rows.deploy = att('deploy', 'green');
    const ev = evaluateForwardChain(rows, FRESH, NOW);
    const d = decideTransition({
      currentState: 'deployed',
      evaluation: ev,
      consecutiveGreensAcrossAllStewards: 1,
      degradedClearThreshold: 3,
    });
    expect(d.newState).toBe('deployed');
    expect(d.trigger).toBe('no-change');
  });
});

describe('DefaultFsmDriver', () => {
  it('exposes evaluate + decide as the default driver', () => {
    expect(DefaultFsmDriver.evaluate).toBe(evaluateForwardChain);
    expect(DefaultFsmDriver.decide).toBe(decideTransition);
  });
});
