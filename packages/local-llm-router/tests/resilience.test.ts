import { describe, it, expect, vi } from 'vitest';
import {
  withTimeout,
  withRetry,
  CircuitBreaker,
  TimeoutError,
  BreakerOpenError,
} from '../src/resilience.js';

describe('withTimeout', () => {
  it('resolves when the inner promise settles before the timer fires', async () => {
    const v = await withTimeout(Promise.resolve(42), 1000, 'unit');
    expect(v).toBe(42);
  });

  it('rejects with TimeoutError when the inner promise never settles', async () => {
    const never = new Promise<number>(() => { /* never */ });
    await expect(withTimeout(never, 5, 'unit')).rejects.toBeInstanceOf(TimeoutError);
  });
});

describe('withRetry', () => {
  it('retries on retryable errors and ultimately succeeds', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new TimeoutError('unit', 10);
      return 'ok';
    };
    const setT: typeof setTimeout = ((cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    const v = await withRetry(fn, { attempts: 3, baseDelayMs: 0, setTimeoutImpl: setT });
    expect(v).toBe('ok');
    expect(calls).toBe(3);
  });

  it('does not retry non-retryable errors', async () => {
    let calls = 0;
    const fn = async () => {
      calls++;
      throw new Error('hard reject — 4xx-style');
    };
    await expect(withRetry(fn, { attempts: 5 })).rejects.toThrow(/hard reject/);
    expect(calls).toBe(1);
  });

  it('emits onRetry callback for each retry', async () => {
    const seen: number[] = [];
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls < 3) throw new TimeoutError('unit', 10);
      return 'ok';
    };
    const setT: typeof setTimeout = ((cb: () => void) => {
      cb();
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout;
    await withRetry(fn, {
      attempts: 3,
      baseDelayMs: 0,
      setTimeoutImpl: setT,
      onRetry: (info) => seen.push(info.attempt),
    });
    expect(seen).toEqual([1, 2]);
  });
});

describe('CircuitBreaker', () => {
  it('opens after failureThreshold consecutive failures', async () => {
    let now = 0;
    const transitions: string[] = [];
    const b = new CircuitBreaker('claude', {
      failureThreshold: 3,
      cooldownMs: 1000,
      now: () => now,
      onStateChange: (i) => transitions.push(`${i.from}->${i.to}`),
    });
    const fail = async () => { throw new Error('boom'); };
    for (let i = 0; i < 3; i++) {
      await expect(b.exec(fail)).rejects.toThrow();
    }
    expect(b.getState()).toBe('open');
    expect(transitions).toContain('closed->open');

    // Next call fast-fails with BreakerOpenError until cooldown.
    await expect(b.exec(fail)).rejects.toBeInstanceOf(BreakerOpenError);
  });

  it('flips to half-open after cooldown and closes on a successful probe', async () => {
    let now = 0;
    const transitions: string[] = [];
    const b = new CircuitBreaker('claude', {
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
      onStateChange: (i) => transitions.push(`${i.from}->${i.to}`),
    });
    await expect(b.exec(async () => { throw new Error('boom'); })).rejects.toThrow();
    expect(b.getState()).toBe('open');

    now = 200;
    const v = await b.exec(async () => 'ok');
    expect(v).toBe('ok');
    expect(b.getState()).toBe('closed');
    expect(transitions).toEqual(['closed->open', 'open->half-open', 'half-open->closed']);
  });

  it('reverts to open if half-open probe also fails', async () => {
    let now = 0;
    const b = new CircuitBreaker('claude', {
      failureThreshold: 1,
      cooldownMs: 100,
      now: () => now,
    });
    await expect(b.exec(async () => { throw new Error('boom'); })).rejects.toThrow();
    expect(b.getState()).toBe('open');
    now = 200;
    await expect(b.exec(async () => { throw new Error('still bad'); })).rejects.toThrow();
    expect(b.getState()).toBe('open');
  });

  it('reset() returns to closed', async () => {
    const b = new CircuitBreaker('local', { failureThreshold: 1 });
    await expect(b.exec(async () => { throw new Error('boom'); })).rejects.toThrow();
    expect(b.getState()).toBe('open');
    b.reset();
    expect(b.getState()).toBe('closed');
    expect(b.getConsecutiveFailures()).toBe(0);
  });
});
