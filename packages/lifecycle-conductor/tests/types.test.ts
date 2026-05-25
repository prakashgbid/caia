import { describe, expect, it } from 'vitest';

import {
  ALL_COMPOSITE_STATES,
  DEFAULT_FRESHNESS_HOURS,
  FORWARD_COMPOSITE_STATES,
  PRODUCING_METRICS_HOLDOVER_HOURS,
  STEWARD_NAMES,
  STICKY_COMPOSITE_STATES,
  TERMINAL_COMPOSITE_STATES,
  isCompositeState,
  isStewardName,
  isTerminalComposite,
  resolveFreshnessHours,
} from '../src/types.js';

describe('STEWARD_NAMES', () => {
  it('contains exactly the five stewards', () => {
    expect(STEWARD_NAMES).toEqual([
      'deploy',
      'usage',
      'activation',
      'outcome',
      'future-incoming',
    ]);
  });
});

describe('isStewardName', () => {
  it('accepts every steward name', () => {
    for (const s of STEWARD_NAMES) {
      expect(isStewardName(s)).toBe(true);
    }
  });
  it('rejects unknown strings + non-strings', () => {
    expect(isStewardName('outcome ')).toBe(false);
    expect(isStewardName('OUTCOME')).toBe(false);
    expect(isStewardName(null)).toBe(false);
    expect(isStewardName(undefined)).toBe(false);
    expect(isStewardName(42)).toBe(false);
    expect(isStewardName({})).toBe(false);
  });
});

describe('isCompositeState', () => {
  it('accepts every composite state', () => {
    for (const s of ALL_COMPOSITE_STATES) {
      expect(isCompositeState(s)).toBe(true);
    }
  });
  it('rejects unknown values', () => {
    expect(isCompositeState('approved')).toBe(false); // operator vocab, not composite
    expect(isCompositeState('done')).toBe(false);
    expect(isCompositeState(null)).toBe(false);
  });
});

describe('composite-state lists', () => {
  it('FORWARD ∪ STICKY = ALL with no overlap', () => {
    const forwardSet = new Set<string>(FORWARD_COMPOSITE_STATES);
    const stickySet = new Set<string>(STICKY_COMPOSITE_STATES);
    for (const s of FORWARD_COMPOSITE_STATES) expect(stickySet.has(s)).toBe(false);
    for (const s of STICKY_COMPOSITE_STATES) expect(forwardSet.has(s)).toBe(false);
    expect(ALL_COMPOSITE_STATES.length).toBe(
      FORWARD_COMPOSITE_STATES.length + STICKY_COMPOSITE_STATES.length,
    );
  });
});

describe('TERMINAL_COMPOSITE_STATES / isTerminalComposite', () => {
  it('only sunset is terminal', () => {
    expect(TERMINAL_COMPOSITE_STATES).toEqual(['sunset']);
    expect(isTerminalComposite('sunset')).toBe(true);
    expect(isTerminalComposite('producing-metrics')).toBe(false);
    expect(isTerminalComposite('degraded')).toBe(false);
    expect(isTerminalComposite('plan-approved')).toBe(false);
  });
});

describe('DEFAULT_FRESHNESS_HOURS', () => {
  it('has freshness for every steward (camelCase keys)', () => {
    expect(DEFAULT_FRESHNESS_HOURS.deploy).toBeGreaterThan(0);
    expect(DEFAULT_FRESHNESS_HOURS.usage).toBeGreaterThan(0);
    expect(DEFAULT_FRESHNESS_HOURS.activation).toBeGreaterThan(0);
    expect(DEFAULT_FRESHNESS_HOURS.outcome).toBeGreaterThan(0);
    expect(DEFAULT_FRESHNESS_HOURS.futureIncoming).toBeGreaterThan(0);
  });
  it('honors the canonical doc §5 ordering (deploy fastest, futureIncoming slowest)', () => {
    expect(DEFAULT_FRESHNESS_HOURS.deploy).toBeLessThan(DEFAULT_FRESHNESS_HOURS.usage);
    expect(DEFAULT_FRESHNESS_HOURS.usage).toBeLessThan(DEFAULT_FRESHNESS_HOURS.activation);
    expect(DEFAULT_FRESHNESS_HOURS.activation).toBeLessThan(DEFAULT_FRESHNESS_HOURS.outcome);
    expect(DEFAULT_FRESHNESS_HOURS.outcome).toBeLessThanOrEqual(
      DEFAULT_FRESHNESS_HOURS.futureIncoming,
    );
  });
});

describe('resolveFreshnessHours', () => {
  it('returns kebab-case keyed defaults when no override', () => {
    const out = resolveFreshnessHours();
    expect(out.deploy).toBe(DEFAULT_FRESHNESS_HOURS.deploy);
    expect(out['future-incoming']).toBe(DEFAULT_FRESHNESS_HOURS.futureIncoming);
  });
  it('applies overrides without losing other keys', () => {
    const out = resolveFreshnessHours({ deploy: 99 });
    expect(out.deploy).toBe(99);
    expect(out.usage).toBe(DEFAULT_FRESHNESS_HOURS.usage);
  });
  it('overrides futureIncoming via the camelCase key', () => {
    const out = resolveFreshnessHours({ futureIncoming: 200 });
    expect(out['future-incoming']).toBe(200);
  });
});

describe('PRODUCING_METRICS_HOLDOVER_HOURS', () => {
  it('is the canonical-doc §6.3 24-hour value', () => {
    expect(PRODUCING_METRICS_HOLDOVER_HOURS).toBe(24);
  });
});
