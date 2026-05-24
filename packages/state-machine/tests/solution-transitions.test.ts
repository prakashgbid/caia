import { describe, expect, it } from 'vitest';

import {
  ALL_SOLUTION_STATES,
  isSolutionTerminal,
  SOLUTION_FAILED_STATES,
  SOLUTION_FORWARD_STATES,
  SOLUTION_ROLLED_BACK_STATES,
  type SolutionState,
} from '../src/entities/solution-states.js';
import {
  allSolutionEdges,
  availableSolutionTransitions,
  canSolutionTransition,
  checkSolutionTransition,
  VALID_SOLUTION_TRANSITIONS,
} from '../src/entities/solution-transitions.js';

describe('solution-transitions', () => {
  it('every state appears as a key in the transition matrix', () => {
    for (const state of ALL_SOLUTION_STATES) {
      expect(VALID_SOLUTION_TRANSITIONS[state]).toBeDefined();
    }
  });

  it('terminal states have zero outbound edges', () => {
    expect(VALID_SOLUTION_TRANSITIONS['done']).toEqual([]);
    expect(VALID_SOLUTION_TRANSITIONS['abandoned']).toEqual([]);
  });

  it('forward path is wired left-to-right', () => {
    for (let i = 0; i < SOLUTION_FORWARD_STATES.length - 1; i++) {
      const from = SOLUTION_FORWARD_STATES[i] as SolutionState;
      const to = SOLUTION_FORWARD_STATES[i + 1] as SolutionState;
      expect(canSolutionTransition(from, to)).toBe(true);
    }
  });

  it('skipping forward states is rejected (e.g. approved → merged)', () => {
    expect(canSolutionTransition('approved', 'merged')).toBe(false);
    expect(canSolutionTransition('approved', 'deployed')).toBe(false);
    expect(canSolutionTransition('deployed', 'producing-metrics')).toBe(false);
  });

  it('self-transitions are rejected', () => {
    for (const state of SOLUTION_FORWARD_STATES) {
      expect(canSolutionTransition(state, state)).toBe(false);
    }
  });

  it('backward forward transitions are rejected (e.g. deployed → merged)', () => {
    expect(canSolutionTransition('deployed', 'merged')).toBe(false);
    expect(canSolutionTransition('producing-metrics', 'called-in-prod')).toBe(false);
  });

  it('each forward state (except approved + done) has a reachable `*-failed` edge', () => {
    // From state F_i you can go to F_{i+1}-failed (next state failed).
    // E.g. approved -> implemented-failed (we tried to implement but failed).
    for (let i = 0; i < SOLUTION_FORWARD_STATES.length - 1; i++) {
      const from = SOLUTION_FORWARD_STATES[i] as SolutionState;
      const nextFailed = `${SOLUTION_FORWARD_STATES[i + 1]}-failed` as SolutionState;
      if (SOLUTION_FAILED_STATES.includes(nextFailed as never)) {
        expect(canSolutionTransition(from, nextFailed)).toBe(true);
      }
    }
  });

  it('each `*-failed` state can recover by retrying the forward state', () => {
    for (const failed of SOLUTION_FAILED_STATES) {
      const forward = failed.replace('-failed', '') as SolutionState;
      expect(canSolutionTransition(failed, forward)).toBe(true);
    }
  });

  it('each `*-failed` state can also be abandoned', () => {
    for (const failed of SOLUTION_FAILED_STATES) {
      expect(canSolutionTransition(failed, 'abandoned')).toBe(true);
    }
  });

  it('each `*-rolled-back` state re-enters the forward state OR abandons', () => {
    for (const rb of SOLUTION_ROLLED_BACK_STATES) {
      const forward = rb.replace('-rolled-back', '') as SolutionState;
      expect(canSolutionTransition(rb, forward)).toBe(true);
      expect(canSolutionTransition(rb, 'abandoned')).toBe(true);
      // ...but cannot jump elsewhere.
      expect(canSolutionTransition(rb, 'done')).toBe(false);
    }
  });

  it('post-deploy forward states can also regress into their `*-rolled-back` sibling', () => {
    expect(canSolutionTransition('deployed', 'deployed-rolled-back')).toBe(true);
    expect(canSolutionTransition('imported', 'imported-rolled-back')).toBe(true);
    expect(canSolutionTransition('producing-metrics', 'producing-metrics-rolled-back')).toBe(true);
  });

  it('every non-terminal state can be paused', () => {
    for (const state of ALL_SOLUTION_STATES) {
      if (isSolutionTerminal(state)) continue;
      if (state === 'paused') continue;
      expect(canSolutionTransition(state, 'paused')).toBe(true);
    }
  });

  it('paused can resume into any non-paused, non-terminal forward state', () => {
    expect(canSolutionTransition('paused', 'approved')).toBe(true);
    expect(canSolutionTransition('paused', 'merged')).toBe(true);
    expect(canSolutionTransition('paused', 'abandoned')).toBe(true);
    // paused cannot exit to itself
    expect(canSolutionTransition('paused', 'paused')).toBe(false);
    // paused cannot directly mark done (resume first; done is reached via producing-metrics)
    expect(canSolutionTransition('paused', 'done')).toBe(false);
  });

  it('every non-terminal state can be abandoned', () => {
    for (const state of ALL_SOLUTION_STATES) {
      if (isSolutionTerminal(state)) continue;
      expect(canSolutionTransition(state, 'abandoned')).toBe(true);
    }
  });

  it('checkSolutionTransition returns structured rejection reason', () => {
    const r1 = checkSolutionTransition('approved', 'deployed');
    expect(r1.ok).toBe(false);
    expect(r1.reason).toContain('not in the solution-lifecycle transition table');

    const r2 = checkSolutionTransition('done', 'approved');
    expect(r2.ok).toBe(false);
    expect(r2.reason).toContain('terminal state');

    const r3 = checkSolutionTransition('approved', 'approved');
    expect(r3.ok).toBe(false);
    expect(r3.reason).toContain('self-transition');

    const r4 = checkSolutionTransition('approved', 'implemented');
    expect(r4.ok).toBe(true);
    expect(r4.reason).toBeUndefined();
  });

  it('availableSolutionTransitions returns the edges for a given state', () => {
    const fromApproved = availableSolutionTransitions('approved');
    expect(fromApproved).toContain('implemented');
    expect(fromApproved).toContain('paused');
    expect(fromApproved).toContain('abandoned');
    expect(fromApproved).toContain('implemented-failed');
  });

  it('allSolutionEdges enumerates the full FSM (≥40 edges)', () => {
    const edges = allSolutionEdges();
    expect(edges.length).toBeGreaterThanOrEqual(40);
    // No edge from terminal.
    for (const e of edges) {
      expect(isSolutionTerminal(e.from)).toBe(false);
    }
  });

  it('terminal-state attempts return ok:false with the correct reason', () => {
    const r1 = checkSolutionTransition('done', 'paused');
    expect(r1.ok).toBe(false);
    expect(r1.reason).toContain('done is a terminal state');
    const r2 = checkSolutionTransition('abandoned', 'approved');
    expect(r2.ok).toBe(false);
    expect(r2.reason).toContain('abandoned is a terminal state');
  });
});
