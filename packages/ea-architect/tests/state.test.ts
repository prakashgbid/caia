import { describe, expect, it, vi } from 'vitest';

import {
  buildEvent,
  canEaReviewTransition,
  chooseTargetState,
  EA_REVIEW_TERMINAL_STATES,
  EA_REVIEW_VALID_TRANSITIONS,
  eventTypeFor,
  InProcessEventBus,
  isEaReviewTerminal
} from '../src/state.js';
import type { EaReviewEvent, ReviewOutcome } from '../src/types.js';

describe('state-machine', () => {
  it('declares all six EA review states', () => {
    const states = Object.keys(EA_REVIEW_VALID_TRANSITIONS);
    expect(states).toContain('ea-review-pending');
    expect(states).toContain('ea-review-revisions-requested');
    expect(states).toContain('ea-review-approved');
    expect(states).toContain('ea-review-conditional-approval');
    expect(states).toContain('ea-review-rejected');
    expect(states).toContain('ea-review-escalated-to-operator');
  });

  it('canEaReviewTransition: pending → approved is valid', () => {
    expect(canEaReviewTransition('ea-review-pending', 'ea-review-approved')).toBe(true);
  });

  it('canEaReviewTransition: approved → anything is invalid (terminal)', () => {
    expect(canEaReviewTransition('ea-review-approved', 'ea-review-rejected')).toBe(false);
    expect(canEaReviewTransition('ea-review-approved', 'ea-review-pending')).toBe(false);
  });

  it('canEaReviewTransition: revisions-requested → pending is valid (caller resubmits)', () => {
    expect(canEaReviewTransition('ea-review-revisions-requested', 'ea-review-pending')).toBe(true);
  });

  it('isEaReviewTerminal: identifies terminal states', () => {
    for (const s of EA_REVIEW_TERMINAL_STATES) {
      expect(isEaReviewTerminal(s)).toBe(true);
    }
    expect(isEaReviewTerminal('ea-review-pending')).toBe(false);
    expect(isEaReviewTerminal('ea-review-revisions-requested')).toBe(false);
  });

  it('chooseTargetState: approved → ea-review-approved', () => {
    expect(chooseTargetState('approved', false, false)).toBe('ea-review-approved');
  });

  it('chooseTargetState: rejected → ea-review-rejected', () => {
    expect(chooseTargetState('rejected', false, false)).toBe('ea-review-rejected');
  });

  it('chooseTargetState: approved-with-modifications → revisions-requested on early iteration', () => {
    expect(chooseTargetState('approved-with-modifications', false, false)).toBe(
      'ea-review-revisions-requested'
    );
  });

  it('chooseTargetState: approved-with-modifications → conditional-approval on final iteration', () => {
    expect(chooseTargetState('approved-with-modifications', true, false)).toBe(
      'ea-review-conditional-approval'
    );
  });

  it('chooseTargetState: escalation always wins', () => {
    expect(chooseTargetState('approved', false, true)).toBe('ea-review-escalated-to-operator');
    expect(chooseTargetState('rejected', false, true)).toBe('ea-review-escalated-to-operator');
  });

  it('eventTypeFor: dot-namespaced format', () => {
    expect(eventTypeFor('ea-review-approved')).toBe('ea-architect.review.approved');
    expect(eventTypeFor('ea-review-escalated-to-operator')).toBe(
      'ea-architect.review.escalated-to-operator'
    );
  });

  it('buildEvent: composes envelope with timestamp ISO', () => {
    const outcome = stubOutcome();
    const event = buildEvent({
      submissionId: 'sub-1',
      callerAgentId: 'tester',
      planType: 'spec',
      iteration: 1,
      fromState: null,
      toState: 'ea-review-approved',
      outcome,
      at: new Date('2026-05-23T12:00:00Z')
    });
    expect(event.type).toBe('ea-architect.review.approved');
    expect(event.submissionId).toBe('sub-1');
    expect(event.at).toBe('2026-05-23T12:00:00.000Z');
    expect(event.outcome.status).toBe('approved');
  });
});

describe('InProcessEventBus', () => {
  it('on(type) fires for the exact type only', async () => {
    const bus = new InProcessEventBus();
    const approved = vi.fn();
    const rejected = vi.fn();
    bus.on('ea-architect.review.approved', approved);
    bus.on('ea-architect.review.rejected', rejected);
    await bus.emit(makeEvent('ea-architect.review.approved'));
    expect(approved).toHaveBeenCalledOnce();
    expect(rejected).not.toHaveBeenCalled();
  });

  it('on("*") fires for every event', async () => {
    const bus = new InProcessEventBus();
    const wildcard = vi.fn();
    bus.on('*', wildcard);
    await bus.emit(makeEvent('ea-architect.review.approved'));
    await bus.emit(makeEvent('ea-architect.review.rejected'));
    expect(wildcard).toHaveBeenCalledTimes(2);
  });

  it('unsubscribe stops further callbacks', async () => {
    const bus = new InProcessEventBus();
    const handler = vi.fn();
    const unsub = bus.on('ea-architect.review.approved', handler);
    await bus.emit(makeEvent('ea-architect.review.approved'));
    unsub();
    await bus.emit(makeEvent('ea-architect.review.approved'));
    expect(handler).toHaveBeenCalledOnce();
  });

  it('emit awaits async handlers', async () => {
    const bus = new InProcessEventBus();
    const order: string[] = [];
    bus.on('*', async () => {
      await new Promise((r) => setTimeout(r, 5));
      order.push('handler');
    });
    await bus.emit(makeEvent('ea-architect.review.approved'));
    order.push('after-emit');
    expect(order).toEqual(['handler', 'after-emit']);
  });
});

function stubOutcome(): ReviewOutcome {
  return {
    status: 'approved',
    reasoning: 'ok',
    cited_adrs: [],
    cited_principles: [],
    cited_lessons: [],
    submissionId: 'sub-1',
    iteration: 1,
    reviewedAtIso: '2026-05-23T12:00:00.000Z',
    modelTier: 'sonnet'
  };
}

function makeEvent(type: string): EaReviewEvent {
  return {
    type,
    submissionId: 'sub-1',
    callerAgentId: 'tester',
    planType: 'spec',
    iteration: 1,
    fromState: null,
    toState: 'ea-review-approved',
    outcome: stubOutcome(),
    at: '2026-05-23T12:00:00.000Z'
  };
}
