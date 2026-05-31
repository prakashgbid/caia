/**
 * Wizard-side retry/backoff wrapper + progress channel tests (B7).
 *
 * Validates that wizardWithRetry plumbs progress events into the
 * per-project channel in the correct order, and that the channel's
 * ring buffer behaves as documented.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  getProgressChannel,
  __resetProgressChannelForTests,
  type ProgressEvent,
} from '../../lib/wizard/progress-channel';
import { wizardWithRetry } from '../../lib/wizard/retry-spawner';

beforeEach(() => {
  vi.useFakeTimers();
  __resetProgressChannelForTests();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('progress-channel', () => {
  it('publishes and reads events keyed by tenantId+projectId', () => {
    const ch = getProgressChannel();
    const key = { tenantId: 't1', projectId: 'p1' };
    const event: ProgressEvent = {
      step: 'interview.answer',
      kind: 'attempt',
      attempt: 1,
      totalAttempts: 4,
      nextDelayMs: 0,
      occurredAtIso: '2026-05-31T00:00:00.000Z',
    };
    ch.publish(key, event);
    const got = ch.read(key);
    expect(got).toHaveLength(1);
    expect(got[0]?.step).toBe('interview.answer');
  });

  it('isolates events between projects', () => {
    const ch = getProgressChannel();
    ch.publish(
      { tenantId: 't1', projectId: 'p1' },
      {
        step: 'interview.answer',
        kind: 'attempt',
        attempt: 1,
        totalAttempts: 4,
        nextDelayMs: 0,
        occurredAtIso: '2026-05-31T00:00:00.000Z',
      },
    );
    expect(ch.read({ tenantId: 't1', projectId: 'p2' })).toEqual([]);
    expect(ch.read({ tenantId: 't2', projectId: 'p1' })).toEqual([]);
  });

  it('truncates the ring buffer at 32 events', () => {
    const ch = getProgressChannel();
    const key = { tenantId: 't1', projectId: 'p1' };
    for (let i = 0; i < 40; i++) {
      ch.publish(key, {
        step: 'interview.answer',
        kind: 'attempt',
        attempt: i,
        totalAttempts: 4,
        nextDelayMs: 0,
        occurredAtIso: `2026-05-31T00:00:${String(i).padStart(2, '0')}.000Z`,
      });
    }
    const got = ch.read(key);
    expect(got).toHaveLength(32);
    // FIFO eviction - first event still present should have attempt=8.
    expect(got[0]?.attempt).toBe(8);
    expect(got[31]?.attempt).toBe(39);
  });

  it('filters by sinceIso', () => {
    const ch = getProgressChannel();
    const key = { tenantId: 't1', projectId: 'p1' };
    ch.publish(key, {
      step: 'interview.answer',
      kind: 'attempt',
      attempt: 1,
      totalAttempts: 4,
      nextDelayMs: 0,
      occurredAtIso: '2026-05-31T00:00:00.000Z',
    });
    ch.publish(key, {
      step: 'interview.answer',
      kind: 'retry',
      attempt: 1,
      totalAttempts: 4,
      nextDelayMs: 30_000,
      occurredAtIso: '2026-05-31T00:00:05.000Z',
    });
    const got = ch.read(key, { sinceIso: '2026-05-31T00:00:02.000Z' });
    expect(got).toHaveLength(1);
    expect(got[0]?.kind).toBe('retry');
  });
});

describe('wizardWithRetry', () => {
  it('publishes attempt + final on first-try success', async () => {
    const key = { tenantId: 't1', projectId: 'p1' };
    const result = await wizardWithRetry(
      { key, step: 'interview.answer' },
      async () => ({ ok: true, value: 'done' }),
    );
    expect(result.ok).toBe(true);
    expect(result.value).toBe('done');
    const events = getProgressChannel().read(key);
    expect(events.map((e) => e.kind)).toEqual(['attempt', 'final']);
    expect(events.every((e) => e.step === 'interview.answer')).toBe(true);
  });

  it('publishes attempt-retry-attempt-final across a transient retry', async () => {
    const key = { tenantId: 't1', projectId: 'p2' };
    let n = 0;
    const result = await wizardWithRetry(
      { key, step: 'proposal.generate' },
      async () => {
        n++;
        if (n === 1) return { ok: false, error: new Error('ECONNRESET') };
        return { ok: true, value: 42 };
      },
      { sleepFn: async () => undefined, random: () => 0.5 },
    );
    expect(result.ok).toBe(true);
    expect(result.attemptsRun).toBe(2);
    const events = getProgressChannel().read(key);
    expect(events.map((e) => e.kind)).toEqual(['attempt', 'retry', 'attempt', 'final']);
    expect(events[1]?.nextDelayMs).toBe(30_000);
    expect(events[1]?.errorClass).toBe('transient');
  });

  it('publishes a final auth event with errorClass=auth and does not retry', async () => {
    const key = { tenantId: 't1', projectId: 'p3' };
    const result = await wizardWithRetry(
      { key, step: 'interview.complete' },
      async () => ({
        ok: false,
        error: new Error('claude is_error=true api_error_status=401'),
      }),
      { sleepFn: async () => undefined },
    );
    expect(result.ok).toBe(false);
    expect(result.finalErrorClass).toBe('auth');
    expect(result.attemptsRun).toBe(1);
    const events = getProgressChannel().read(key);
    expect(events.map((e) => e.kind)).toEqual(['attempt', 'final']);
    expect(events[1]?.errorClass).toBe('auth');
  });
});
