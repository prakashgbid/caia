import { describe, expect, it } from 'vitest';
import {
  canRuntimeTransition,
  InvalidRuntimeTransitionError,
  isRuntimeTerminal,
  RUNTIME_STATES,
  RUNTIME_TERMINAL_STATES,
  RUNTIME_VALID_TRANSITIONS,
  RuntimeStateMachine,
} from '../src/state.js';

describe('runtime state machine', () => {
  it('declares every state used by the runtime', () => {
    expect(RUNTIME_STATES).toContain('idle');
    expect(RUNTIME_STATES).toContain('loading-spec');
    expect(RUNTIME_STATES).toContain('preconditions-checking');
    expect(RUNTIME_STATES).toContain('acquiring-capability');
    expect(RUNTIME_STATES).toContain('deploying');
    expect(RUNTIME_STATES).toContain('verifying');
    expect(RUNTIME_STATES).toContain('succeeded');
    expect(RUNTIME_STATES).toContain('failed');
    expect(RUNTIME_STATES).toContain('rolling-back');
    expect(RUNTIME_STATES).toContain('rolled-back');
    expect(RUNTIME_STATES).toContain('rollback-failed');
  });

  it('marks terminal states correctly', () => {
    expect(isRuntimeTerminal('succeeded')).toBe(false); // can still go to rolling-back
    expect(isRuntimeTerminal('rolled-back')).toBe(true);
    expect(isRuntimeTerminal('rollback-failed')).toBe(true);
    expect(RUNTIME_TERMINAL_STATES).toContain('rolled-back');
    expect(RUNTIME_TERMINAL_STATES).toContain('rollback-failed');
  });

  it('allows the happy path: idle → loading-spec → preconditions-checking → acquiring-capability → deploying → verifying → succeeded', () => {
    const path: Array<[string, string]> = [
      ['idle', 'loading-spec'],
      ['loading-spec', 'preconditions-checking'],
      ['preconditions-checking', 'acquiring-capability'],
      ['acquiring-capability', 'deploying'],
      ['deploying', 'verifying'],
      ['verifying', 'succeeded'],
    ];
    for (const [from, to] of path) {
      expect(canRuntimeTransition(from as any, to as any)).toBe(true);
    }
  });

  it('allows failed → rolling-back → rolled-back', () => {
    expect(canRuntimeTransition('failed', 'rolling-back')).toBe(true);
    expect(canRuntimeTransition('rolling-back', 'rolled-back')).toBe(true);
    expect(canRuntimeTransition('rolling-back', 'rollback-failed')).toBe(true);
  });

  it('allows succeeded → rolling-back (post-deploy regression)', () => {
    expect(canRuntimeTransition('succeeded', 'rolling-back')).toBe(true);
  });

  it('rejects self-transitions', () => {
    for (const state of RUNTIME_STATES) {
      expect(canRuntimeTransition(state, state)).toBe(false);
    }
  });

  it('rejects skipping straight from idle to succeeded', () => {
    expect(canRuntimeTransition('idle', 'succeeded')).toBe(false);
  });

  it('rejects transitions out of terminal states', () => {
    expect(canRuntimeTransition('rolled-back', 'succeeded')).toBe(false);
    expect(canRuntimeTransition('rollback-failed', 'succeeded')).toBe(false);
  });

  it('every transition table entry is in RUNTIME_STATES', () => {
    for (const [from, tos] of Object.entries(RUNTIME_VALID_TRANSITIONS)) {
      expect(RUNTIME_STATES).toContain(from as any);
      for (const to of tos) {
        expect(RUNTIME_STATES).toContain(to);
      }
    }
  });

  it('RuntimeStateMachine records every transition in trace', () => {
    const sm = new RuntimeStateMachine({ ticketId: 'TKT-1' });
    sm.transition('loading-spec', 'r1');
    sm.transition('preconditions-checking', 'r2');
    sm.transition('acquiring-capability', 'r3');
    expect(sm.trace).toHaveLength(3);
    expect(sm.trace[0]?.fromState).toBe('idle');
    expect(sm.trace[0]?.toState).toBe('loading-spec');
    expect(sm.trace[0]?.reason).toBe('r1');
    expect(sm.state).toBe('acquiring-capability');
  });

  it('RuntimeStateMachine throws on invalid transition', () => {
    const sm = new RuntimeStateMachine({ ticketId: 'TKT-2' });
    expect(() => sm.transition('succeeded')).toThrow(InvalidRuntimeTransitionError);
    // The trace remains empty since no successful transition happened.
    expect(sm.trace).toHaveLength(0);
    expect(sm.state).toBe('idle');
  });

  it('RuntimeStateMachine fires onTransition callback', () => {
    const events: Array<{ from: string; to: string }> = [];
    const sm = new RuntimeStateMachine({
      ticketId: 'TKT-3',
      onTransition: (e) => events.push({ from: e.fromState, to: e.toState }),
    });
    sm.transition('loading-spec');
    sm.transition('failed', 'load failed');
    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ from: 'idle', to: 'loading-spec' });
    expect(events[1]).toEqual({ from: 'loading-spec', to: 'failed' });
  });
});
