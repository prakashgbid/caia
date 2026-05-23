import { describe, expect, it } from 'vitest';

import {
  AdvisoryLockHeldError,
  InvalidTransitionError,
  ProjectNotFoundError,
  StaleProjectVersionError,
  TicketAlreadyClaimedError,
  TransitionRetryExhaustedError,
} from '../src/errors.js';

describe('typed errors', () => {
  it('InvalidTransitionError exposes from/to/reason', () => {
    const e = new InvalidTransitionError('onboarding', 'done', 'because');
    expect(e.from).toBe('onboarding');
    expect(e.to).toBe('done');
    expect(e.reasonDetail).toBe('because');
    expect(e.name).toBe('InvalidTransitionError');
    expect(e.message).toContain('because');
  });

  it('InvalidTransitionError without reason has a clean message', () => {
    const e = new InvalidTransitionError('onboarding', 'done');
    expect(e.message).toBe('invalid transition onboarding -> done');
  });

  it('StaleProjectVersionError carries projectId + expectedVersion', () => {
    const e = new StaleProjectVersionError('pid', 7);
    expect(e.projectId).toBe('pid');
    expect(e.expectedVersion).toBe(7);
    expect(e.message).toContain('7');
  });

  it('ProjectNotFoundError carries projectId', () => {
    const e = new ProjectNotFoundError('pid');
    expect(e.projectId).toBe('pid');
  });

  it('AdvisoryLockHeldError carries projectId', () => {
    const e = new AdvisoryLockHeldError('pid');
    expect(e.projectId).toBe('pid');
  });

  it('TicketAlreadyClaimedError carries ticketId + claimedBy', () => {
    const e = new TicketAlreadyClaimedError('t1', 'agent-A');
    expect(e.ticketId).toBe('t1');
    expect(e.claimedBy).toBe('agent-A');
    expect(e.message).toContain('agent-A');
  });

  it('TicketAlreadyClaimedError without claimedBy has a generic message', () => {
    const e = new TicketAlreadyClaimedError('t1');
    expect(e.message).toBe('ticket t1 already claimed');
  });

  it('TransitionRetryExhaustedError carries projectId + attempts', () => {
    const e = new TransitionRetryExhaustedError('pid', 4);
    expect(e.projectId).toBe('pid');
    expect(e.attempts).toBe(4);
    expect(e.message).toContain('4');
  });

  it('all errors inherit from Error', () => {
    expect(new InvalidTransitionError('onboarding', 'done')).toBeInstanceOf(Error);
    expect(new StaleProjectVersionError('p', 1)).toBeInstanceOf(Error);
    expect(new ProjectNotFoundError('p')).toBeInstanceOf(Error);
    expect(new AdvisoryLockHeldError('p')).toBeInstanceOf(Error);
    expect(new TicketAlreadyClaimedError('t')).toBeInstanceOf(Error);
    expect(new TransitionRetryExhaustedError('p', 1)).toBeInstanceOf(Error);
  });
});
