import { describe, expect, it } from 'vitest';

import {
  ALL_SOLUTION_STATES,
  DEFAULT_STUCK_THRESHOLDS_HOURS,
  FAILED_OF,
  FORWARD_OF_FAILED,
  FORWARD_OF_ROLLED_BACK,
  isSolutionControlState,
  isSolutionFailedState,
  isSolutionForwardState,
  isSolutionRolledBackState,
  isSolutionState,
  isSolutionTerminal,
  ROLLED_BACK_OF,
  SOLUTION_CONTROL_STATES,
  SOLUTION_FAILED_STATES,
  SOLUTION_FORWARD_STATES,
  SOLUTION_INITIAL_STATE,
  SOLUTION_ROLLED_BACK_STATES,
  SOLUTION_STATE_CANONICAL_SYNONYM,
  SOLUTION_TERMINAL_STATES,
} from '../src/entities/solution-states.js';

describe('solution-states', () => {
  it('declares 9 forward states', () => {
    expect(SOLUTION_FORWARD_STATES).toHaveLength(9);
    expect(SOLUTION_FORWARD_STATES[0]).toBe('approved');
    expect(SOLUTION_FORWARD_STATES[SOLUTION_FORWARD_STATES.length - 1]).toBe('done');
  });

  it('declares 7 failed-state variants (one per non-initial forward state)', () => {
    expect(SOLUTION_FAILED_STATES).toHaveLength(7);
    for (const failed of SOLUTION_FAILED_STATES) {
      expect(failed.endsWith('-failed')).toBe(true);
    }
  });

  it('declares 5 rolled-back variants (post-deployment forward states)', () => {
    expect(SOLUTION_ROLLED_BACK_STATES).toHaveLength(5);
    for (const rb of SOLUTION_ROLLED_BACK_STATES) {
      expect(rb.endsWith('-rolled-back')).toBe(true);
    }
  });

  it('declares 2 control states: paused + abandoned', () => {
    expect(SOLUTION_CONTROL_STATES).toEqual(['paused', 'abandoned']);
  });

  it('ALL_SOLUTION_STATES is the union of the four buckets, with no duplicates', () => {
    expect(ALL_SOLUTION_STATES).toHaveLength(9 + 7 + 5 + 2);
    const set = new Set<string>(ALL_SOLUTION_STATES);
    expect(set.size).toBe(ALL_SOLUTION_STATES.length);
  });

  it('isSolutionState narrows correctly', () => {
    expect(isSolutionState('approved')).toBe(true);
    expect(isSolutionState('producing-metrics')).toBe(true);
    expect(isSolutionState('producing-metrics-rolled-back')).toBe(true);
    expect(isSolutionState('not-a-state')).toBe(false);
    expect(isSolutionState(42)).toBe(false);
    expect(isSolutionState(null)).toBe(false);
  });

  it('bucket-narrowing predicates are mutually exclusive', () => {
    for (const state of ALL_SOLUTION_STATES) {
      const f = isSolutionForwardState(state) ? 1 : 0;
      const ff = isSolutionFailedState(state) ? 1 : 0;
      const rb = isSolutionRolledBackState(state) ? 1 : 0;
      const c = isSolutionControlState(state) ? 1 : 0;
      expect(f + ff + rb + c).toBe(1);
    }
  });

  it('initial state is "approved"', () => {
    expect(SOLUTION_INITIAL_STATE).toBe('approved');
    expect(isSolutionForwardState(SOLUTION_INITIAL_STATE)).toBe(true);
  });

  it('terminal states are exactly {done, abandoned}', () => {
    expect(SOLUTION_TERMINAL_STATES).toEqual(['done', 'abandoned']);
    expect(isSolutionTerminal('done')).toBe(true);
    expect(isSolutionTerminal('abandoned')).toBe(true);
    expect(isSolutionTerminal('approved')).toBe(false);
    expect(isSolutionTerminal('paused')).toBe(false);
  });

  it('FAILED_OF maps every non-initial forward state to its `*-failed` variant', () => {
    for (const fwd of SOLUTION_FORWARD_STATES) {
      if (fwd === 'approved') continue; // no implemented-failed precursor
      if (fwd === 'done') continue; // done has no -failed sibling; it's terminal
      const failed = FAILED_OF[fwd as keyof typeof FAILED_OF];
      expect(failed).toBe(`${fwd}-failed`);
      expect(isSolutionFailedState(failed!)).toBe(true);
    }
  });

  it('FORWARD_OF_FAILED is the inverse of FAILED_OF', () => {
    for (const failed of SOLUTION_FAILED_STATES) {
      const fwd = FORWARD_OF_FAILED[failed];
      expect(fwd).toBe(failed.replace('-failed', ''));
    }
  });

  it('ROLLED_BACK_OF covers post-deployment forward states only', () => {
    expect(Object.keys(ROLLED_BACK_OF)).toEqual([
      'deployed',
      'imported',
      'called-in-test',
      'called-in-prod',
      'producing-metrics',
    ]);
  });

  it('FORWARD_OF_ROLLED_BACK is the inverse of ROLLED_BACK_OF', () => {
    for (const rb of SOLUTION_ROLLED_BACK_STATES) {
      const fwd = FORWARD_OF_ROLLED_BACK[rb];
      expect(fwd).toBe(rb.replace('-rolled-back', ''));
    }
  });

  it('canonical synonyms cover the four states that have a different canonical-doc name', () => {
    expect(SOLUTION_STATE_CANONICAL_SYNONYM['approved']).toBe('plan-approved');
    expect(SOLUTION_STATE_CANONICAL_SYNONYM['implemented']).toBe('code-written');
    expect(SOLUTION_STATE_CANONICAL_SYNONYM['merged']).toBe('pr-merged');
    expect(SOLUTION_STATE_CANONICAL_SYNONYM['imported']).toBe('built-into-active-app');
  });

  it('DEFAULT_STUCK_THRESHOLDS_HOURS covers every non-terminal forward state', () => {
    for (const fwd of SOLUTION_FORWARD_STATES) {
      if (fwd === 'done') continue;
      expect(DEFAULT_STUCK_THRESHOLDS_HOURS[fwd]).toBeGreaterThan(0);
    }
  });

  it('default thresholds match the canonical manifest numbers', () => {
    // merged → deployed must be ≤2h (canonical deploy_steward_max_age)
    expect(DEFAULT_STUCK_THRESHOLDS_HOURS['merged']).toBe(2);
    // deployed → imported must be ≤4h (canonical usage_steward_max_age)
    expect(DEFAULT_STUCK_THRESHOLDS_HOURS['deployed']).toBe(4);
    // imported → called-in-test must be ≤6h (canonical activation_steward_max_age)
    expect(DEFAULT_STUCK_THRESHOLDS_HOURS['imported']).toBe(6);
    // called-in-prod → producing-metrics must be ≤24h (canonical outcome_steward_max_age)
    expect(DEFAULT_STUCK_THRESHOLDS_HOURS['called-in-prod']).toBe(24);
    // producing-metrics → done must be ≤24h (canonical §6.3 holdover)
    expect(DEFAULT_STUCK_THRESHOLDS_HOURS['producing-metrics']).toBe(24);
  });
});
