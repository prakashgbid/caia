import { describe, expect, it } from 'vitest';

import * as mod from '../src/index.js';

describe('public surface', () => {
  it('re-exports state constants', () => {
    expect(mod.ALL_STATES.length).toBeGreaterThan(0);
    expect(mod.HAPPY_STATES.length).toBeGreaterThan(0);
    expect(mod.FAILED_STATES.length).toBeGreaterThan(0);
    expect(mod.CONTROL_STATES.length).toBeGreaterThan(0);
    expect(mod.TERMINAL_STATES.length).toBeGreaterThan(0);
  });

  it('re-exports state classifiers', () => {
    expect(typeof mod.isProjectState).toBe('function');
    expect(typeof mod.isHappyState).toBe('function');
    expect(typeof mod.isFailedState).toBe('function');
    expect(typeof mod.isControlState).toBe('function');
    expect(typeof mod.isTerminal).toBe('function');
  });

  it('re-exports transition helpers', () => {
    expect(typeof mod.canTransition).toBe('function');
    expect(typeof mod.checkTransition).toBe('function');
    expect(typeof mod.availableTransitions).toBe('function');
    expect(typeof mod.validNextStates).toBe('function');
    expect(typeof mod.allEdges).toBe('function');
    expect(typeof mod.reachableTerminals).toBe('function');
    expect(mod.VALID_TRANSITIONS).toBeDefined();
  });

  it('re-exports errors', () => {
    expect(typeof mod.InvalidTransitionError).toBe('function');
    expect(typeof mod.StaleProjectVersionError).toBe('function');
    expect(typeof mod.ProjectNotFoundError).toBe('function');
    expect(typeof mod.AdvisoryLockHeldError).toBe('function');
    expect(typeof mod.TicketAlreadyClaimedError).toBe('function');
    expect(typeof mod.TransitionRetryExhaustedError).toBe('function');
  });

  it('re-exports core machinery', () => {
    expect(typeof mod.StateMachine).toBe('function');
    expect(typeof mod.InMemoryStateStore).toBe('function');
    expect(typeof mod.PgStateStore).toBe('function');
    expect(typeof mod.hashPayload).toBe('function');
  });

  it('re-exports realtime helpers', () => {
    expect(typeof mod.handleProjectSse).toBe('function');
    expect(typeof mod.SseConnection).toBe('function');
  });

  it('re-exports whats-next helpers', () => {
    expect(typeof mod.whatsNext).toBe('function');
    expect(typeof mod.resumePoint).toBe('function');
  });
});
