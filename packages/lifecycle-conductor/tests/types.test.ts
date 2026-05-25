import { describe, expect, it } from 'vitest';

import {
  ALL_COMPOSITE_STATES,
  DEFAULT_FRESHNESS_HOURS,
  EA_REVIEW_EVENT_KIND,
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

describe('STEWARD_NAMES — ADR-063 4-steward strict', () => {
  it('contains exactly the four Real-DoD stewards', () => {
    expect(STEWARD_NAMES).toEqual([
      'deploy',
      'usage',
      'activation',
      'outcome',
    ]);
  });
  it('does NOT include future-incoming (retired per ADR-063)', () => {
    expect(STEWARD_NAMES as readonly string[]).not.toContain('future-incoming');
  });
  it('does NOT include drift-sentinel / pipeline-conductor (different gate, different runbook)', () => {
    expect(STEWARD_NAMES as readonly string[]).not.toContain('drift-sentinel');
    expect(STEWARD_NAMES as readonly string[]).not.toContain('pipeline-conductor');
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
  it('rejects the retired future-incoming legacy name', () => {
    expect(isStewardName('future-incoming')).toBe(false);
  });
  it('rejects drift-sentinel-shaped envelope names', () => {
    expect(isStewardName('drift-sentinel')).toBe(false);
    expect(isStewardName('pipeline-conductor')).toBe(false);
    expect(isStewardName('policy-violation')).toBe(false);
    expect(isStewardName('architecture-principle-violated')).toBe(false);
  });
});

describe('EA_REVIEW_EVENT_KIND', () => {
  it('is the canonical ea-review-approved envelope kind', () => {
    expect(EA_REVIEW_EVENT_KIND).toBe('ea-review-approved');
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
  });
  it('honors the canonical doc §5 ordering (deploy fastest, outcome slowest)', () => {
    expect(DEFAULT_FRESHNESS_HOURS.deploy).toBeLessThan(DEFAULT_FRESHNESS_HOURS.usage);
    expect(DEFAULT_FRESHNESS_HOURS.usage).toBeLessThan(DEFAULT_FRESHNESS_HOURS.activation);
    expect(DEFAULT_FRESHNESS_HOURS.activation).toBeLessThan(DEFAULT_FRESHNESS_HOURS.outcome);
  });
  it('does NOT carry a futureIncoming key (retired per ADR-063)', () => {
    expect((DEFAULT_FRESHNESS_HOURS as Record<string, unknown>).futureIncoming).toBeUndefined();
  });
});

describe('resolveFreshnessHours', () => {
  it('returns kebab-case keyed defaults when no override', () => {
    const out = resolveFreshnessHours();
    expect(out.deploy).toBe(DEFAULT_FRESHNESS_HOURS.deploy);
    expect(out.outcome).toBe(DEFAULT_FRESHNESS_HOURS.outcome);
  });
  it('applies overrides without losing other keys', () => {
    const out = resolveFreshnessHours({ deploy: 99 });
    expect(out.deploy).toBe(99);
    expect(out.usage).toBe(DEFAULT_FRESHNESS_HOURS.usage);
  });
  it('returns exactly 4 keys (no future-incoming)', () => {
    const out = resolveFreshnessHours();
    expect(Object.keys(out).sort()).toEqual([
      'activation',
      'deploy',
      'outcome',
      'usage',
    ]);
  });
});

describe('PRODUCING_METRICS_HOLDOVER_HOURS', () => {
  it('is the canonical-doc §6.3 24-hour value', () => {
    expect(PRODUCING_METRICS_HOLDOVER_HOURS).toBe(24);
  });
});
