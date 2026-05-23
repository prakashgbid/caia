import { describe, expect, it } from 'vitest';

import {
  ALL_STATES,
  CONTROL_STATES,
  FAILED_STATES,
  HAPPY_STATES,
  isControlState,
  isFailedState,
  isHappyState,
  isProjectState,
  isTerminal,
  TERMINAL_STATES,
} from '../src/states.js';

describe('states', () => {
  it('enumerates 23 happy states', () => {
    expect(HAPPY_STATES.length).toBe(23);
  });

  it('enumerates 15 failed states', () => {
    expect(FAILED_STATES.length).toBe(15);
  });

  it('enumerates 3 control states', () => {
    expect(CONTROL_STATES.length).toBe(3);
  });

  it('ALL_STATES is the concatenation of happy + failed + control', () => {
    expect(ALL_STATES.length).toBe(
      HAPPY_STATES.length + FAILED_STATES.length + CONTROL_STATES.length,
    );
    expect(new Set(ALL_STATES).size).toBe(ALL_STATES.length);
  });

  it('every failed state ends with -failed', () => {
    for (const s of FAILED_STATES) expect(s.endsWith('-failed')).toBe(true);
  });

  it('isProjectState accepts canonical states', () => {
    expect(isProjectState('onboarding')).toBe(true);
    expect(isProjectState('archived')).toBe(true);
    expect(isProjectState('done')).toBe(true);
  });

  it('isProjectState rejects garbage', () => {
    expect(isProjectState('definitely-not-a-state')).toBe(false);
    expect(isProjectState(42)).toBe(false);
    expect(isProjectState(null)).toBe(false);
    expect(isProjectState(undefined)).toBe(false);
  });

  it('classifies states correctly', () => {
    expect(isHappyState('done')).toBe(true);
    expect(isHappyState('onboarding-failed' as never)).toBe(false);
    expect(isFailedState('onboarding-failed')).toBe(true);
    expect(isFailedState('done' as never)).toBe(false);
    expect(isControlState('paused')).toBe(true);
    expect(isControlState('done' as never)).toBe(false);
  });

  it('only done + archived are terminal', () => {
    expect(TERMINAL_STATES).toEqual(['done', 'archived']);
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('archived')).toBe(true);
    expect(isTerminal('onboarding')).toBe(false);
    expect(isTerminal('paused')).toBe(false);
  });
});
