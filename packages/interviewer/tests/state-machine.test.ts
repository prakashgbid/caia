import { describe, expect, it } from 'vitest';

import { StateMachine, allowedTransitionsFrom, transitionGraph } from '../src/state-machine.js';
import { InterviewerError } from '../src/errors.js';
import { INTERVIEW_STATES, isTerminal } from '../src/types.js';

describe('StateMachine — adjacency contract', () => {
  it('matches the spec §1.2 transition table for every state', () => {
    const graph = transitionGraph();
    expect(graph.INIT).toEqual(['PLANNING', 'FORCE_CLOSED']);
    expect(graph.PLANNING).toEqual(['ASKING', 'FORCE_CLOSED']);
    expect(graph.ASKING).toEqual(['AWAITING_USER', 'FORCE_CLOSED']);
    expect(graph.AWAITING_USER).toEqual(['INGESTING', 'PAUSED', 'FORCE_CLOSED']);
    expect(graph.INGESTING).toEqual(['EVALUATING', 'FORCE_CLOSED']);
    expect(graph.EVALUATING).toEqual(['PLANNING', 'SELF_CRITIQUE', 'FORCE_CLOSED']);
    expect(graph.SELF_CRITIQUE).toEqual(['PLANNING', 'COMPLETE', 'FORCE_CLOSED']);
    expect(graph.COMPLETE).toEqual(['HANDOFF']);
    expect(graph.PAUSED).toEqual(['PLANNING', 'FORCE_CLOSED']);
    expect(graph.HANDOFF).toEqual([]);
    expect(graph.FORCE_CLOSED).toEqual([]);
  });

  it('terminal states have empty adjacency lists', () => {
    expect(allowedTransitionsFrom('HANDOFF')).toEqual([]);
    expect(allowedTransitionsFrom('FORCE_CLOSED')).toEqual([]);
  });

  it('every INTERVIEW_STATES entry appears as a key in the graph', () => {
    const graph = transitionGraph();
    for (const s of INTERVIEW_STATES) {
      expect(graph[s]).toBeDefined();
    }
  });
});

describe('StateMachine — happy path', () => {
  it('walks INIT to HANDOFF in 8 transitions', () => {
    const m = new StateMachine();
    expect(m.state).toBe('INIT');
    m.transition({ to: 'PLANNING', reason: 'init_done' });
    m.transition({ to: 'ASKING', reason: 'picked', turnNumber: 1 });
    m.transition({ to: 'AWAITING_USER', reason: 'sent' });
    m.transition({ to: 'INGESTING', reason: 'user_reply' });
    m.transition({ to: 'EVALUATING', reason: 'ingested' });
    m.transition({ to: 'SELF_CRITIQUE', reason: 'threshold' });
    m.transition({ to: 'COMPLETE', reason: 'clean' });
    m.transition({ to: 'HANDOFF', reason: 'emit' });
    expect(m.state).toBe('HANDOFF');
    expect(isTerminal(m.state)).toBe(true);
    expect(m.history).toHaveLength(8);
  });

  it('loops EVALUATING to PLANNING when score < 82', () => {
    const m = new StateMachine();
    m.transition({ to: 'PLANNING', reason: '' });
    m.transition({ to: 'ASKING', reason: '' });
    m.transition({ to: 'AWAITING_USER', reason: '' });
    m.transition({ to: 'INGESTING', reason: '' });
    m.transition({ to: 'EVALUATING', reason: '' });
    m.transition({ to: 'PLANNING', reason: 'score_underflow' });
    expect(m.state).toBe('PLANNING');
  });

  it('loops SELF_CRITIQUE to PLANNING when critic surfaces gaps', () => {
    const m = new StateMachine('SELF_CRITIQUE');
    m.transition({ to: 'PLANNING', reason: 'critic_rollback' });
    expect(m.state).toBe('PLANNING');
  });
});

describe('StateMachine — invalid transitions', () => {
  it('throws when transitioning to an unreachable state', () => {
    const m = new StateMachine();
    expect(() => m.transition({ to: 'ASKING', reason: 'skip_planning' })).toThrowError(InterviewerError);
  });

  it('throws when transitioning out of a terminal state', () => {
    const m = new StateMachine();
    m.transition({ to: 'PLANNING', reason: '' });
    m.transition({ to: 'ASKING', reason: '' });
    m.transition({ to: 'AWAITING_USER', reason: '' });
    m.transition({ to: 'INGESTING', reason: '' });
    m.transition({ to: 'EVALUATING', reason: '' });
    m.transition({ to: 'SELF_CRITIQUE', reason: '' });
    m.transition({ to: 'COMPLETE', reason: '' });
    m.transition({ to: 'HANDOFF', reason: '' });
    expect(() => m.transition({ to: 'PLANNING', reason: 'after_handoff' })).toThrowError(InterviewerError);
  });
});

describe('StateMachine — force-close & resume', () => {
  it('force-closes from any non-terminal state', () => {
    const m = new StateMachine();
    m.transition({ to: 'PLANNING', reason: '' });
    m.transition({ to: 'ASKING', reason: '' });
    const t = m.forceClose('operator_dashboard_button');
    expect(t).not.toBeNull();
    expect(m.state).toBe('FORCE_CLOSED');
  });

  it('force-close is idempotent on already-FORCE_CLOSED', () => {
    const m = new StateMachine();
    m.transition({ to: 'PLANNING', reason: '' });
    m.forceClose('first');
    const second = m.forceClose('second');
    expect(second).toBeNull();
    expect(m.state).toBe('FORCE_CLOSED');
  });

  it('force-close throws if already HANDOFF', () => {
    const m = new StateMachine();
    m.transition({ to: 'PLANNING', reason: '' });
    m.transition({ to: 'ASKING', reason: '' });
    m.transition({ to: 'AWAITING_USER', reason: '' });
    m.transition({ to: 'INGESTING', reason: '' });
    m.transition({ to: 'EVALUATING', reason: '' });
    m.transition({ to: 'SELF_CRITIQUE', reason: '' });
    m.transition({ to: 'COMPLETE', reason: '' });
    m.transition({ to: 'HANDOFF', reason: '' });
    expect(() => m.forceClose('late')).toThrowError(InterviewerError);
  });

  it('resume() goes from PAUSED to PLANNING', () => {
    const m = new StateMachine('AWAITING_USER');
    m.transition({ to: 'PAUSED', reason: 'timeout' });
    const t = m.resume();
    expect(t.to).toBe('PLANNING');
    expect(m.state).toBe('PLANNING');
  });

  it('resume() throws if not in PAUSED', () => {
    const m = new StateMachine('ASKING');
    expect(() => m.resume()).toThrowError(InterviewerError);
  });
});

describe('StateMachine — turn bookkeeping', () => {
  it('bumpTurn increments correctly', () => {
    const m = new StateMachine();
    expect(m.turnNumber).toBe(0);
    expect(m.bumpTurn()).toBe(1);
    expect(m.bumpTurn(5)).toBe(5);
    expect(m.turnNumber).toBe(5);
  });

  it('history captures every transition', () => {
    const m = new StateMachine();
    m.transition({ to: 'PLANNING', reason: 'a' });
    m.transition({ to: 'ASKING', reason: 'b', turnNumber: 1 });
    m.transition({ to: 'AWAITING_USER', reason: 'c' });
    expect(m.history).toHaveLength(3);
    expect(m.history[0]!.from).toBe('INIT');
    expect(m.history[0]!.to).toBe('PLANNING');
    expect(m.history[1]!.turnNumber).toBe(1);
  });

  it('snapshot returns independent history copy', () => {
    const m = new StateMachine();
    m.transition({ to: 'PLANNING', reason: 'a' });
    const snap = m.snapshot();
    m.transition({ to: 'ASKING', reason: 'b' });
    expect(snap.history).toHaveLength(1);
    expect(m.history).toHaveLength(2);
  });
});
