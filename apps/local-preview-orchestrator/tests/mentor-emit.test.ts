/**
 * Unit tests for LazyMentor (PR-H, leg-4 stage-6 finding).
 *
 * Covers:
 *   - lazy open: client constructed on first getOrOpen()
 *   - cache: subsequent getOrOpen() returns cached client
 *   - retry on prior failure: getOrOpen() retries when client is undefined
 *   - opt-out: CAIA_EVENT_BUS_DISABLED=1 returns undefined unconditionally
 *   - env-var override: CAIA_EVENT_BUS_DB_PATH wins over default
 *   - warn throttling: at most one warn per warnIntervalMs window
 *   - emit fire-and-forget: false on unavailable; true on success
 *   - emit swallow: throws inside underlying emit do not bubble
 */

import { describe, it, expect, vi } from 'vitest';

import { LazyMentor } from '../src/mentor-emit.js';

type FakeMentor = {
  emit: ReturnType<typeof vi.fn>;
  close?: () => void;
  __dbPath: string;
};

function makeFakeFactory(opts?: {
  failOnceCount?: number;
  emitThrows?: boolean;
}): {
  factory: (o: { dbPath: string; processName: string }) => FakeMentor;
  callCount: () => number;
  lastDbPath: () => string | undefined;
  emitCalls: () => Array<[unknown, unknown]>;
} {
  let calls = 0;
  let lastDbPath: string | undefined;
  const emitCalls: Array<[unknown, unknown]> = [];
  const factory = (o: { dbPath: string; processName: string }): FakeMentor => {
    calls++;
    lastDbPath = o.dbPath;
    if (opts?.failOnceCount && calls <= opts.failOnceCount) {
      throw new Error(`fake-open-fail attempt ${calls}`);
    }
    return {
      emit: vi.fn().mockImplementation((_t, _p) => {
        if (opts?.emitThrows) throw new Error('fake-emit-throw');
        emitCalls.push([_t, _p]);
      }),
      __dbPath: o.dbPath
    };
  };
  return {
    factory: factory as unknown as (o: { dbPath: string; processName: string }) => FakeMentor,
    callCount: () => calls,
    lastDbPath: () => lastDbPath,
    emitCalls: () => emitCalls
  };
}

describe('LazyMentor', () => {
  it('lazily opens on first getOrOpen', () => {
    const f = makeFakeFactory();
    const m = new LazyMentor({
      defaultDbPath: '/tmp/default.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any
    });
    expect(f.callCount()).toBe(0); // not yet opened
    const c = m.getOrOpen({});
    expect(c).toBeDefined();
    expect(f.callCount()).toBe(1);
    expect(f.lastDbPath()).toBe('/tmp/default.sqlite');
  });

  it('caches the client across calls', () => {
    const f = makeFakeFactory();
    const m = new LazyMentor({
      defaultDbPath: '/tmp/default.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any
    });
    const a = m.getOrOpen({});
    const b = m.getOrOpen({});
    const c = m.getOrOpen({});
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(f.callCount()).toBe(1);
  });

  it('retries opening when the previous attempt failed', () => {
    const f = makeFakeFactory({ failOnceCount: 2 });
    const warns: string[] = [];
    const m = new LazyMentor({
      defaultDbPath: '/tmp/x.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any,
      warn: (msg) => warns.push(msg),
      warnIntervalMs: 0 // log every warning, no throttling for this test
    });
    expect(m.getOrOpen({})).toBeUndefined(); // attempt 1 → fail
    expect(m.getOrOpen({})).toBeUndefined(); // attempt 2 → fail
    expect(m.getOrOpen({})).toBeDefined(); //   attempt 3 → success
    expect(f.callCount()).toBe(3);
    // After success, no more open attempts
    m.getOrOpen({});
    expect(f.callCount()).toBe(3);
  });

  it('returns undefined unconditionally when CAIA_EVENT_BUS_DISABLED=1', () => {
    const f = makeFakeFactory();
    const m = new LazyMentor({
      defaultDbPath: '/tmp/x.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any
    });
    expect(m.getOrOpen({ CAIA_EVENT_BUS_DISABLED: '1' })).toBeUndefined();
    expect(m.getOrOpen({ CAIA_EVENT_BUS_DISABLED: '1' })).toBeUndefined();
    // No open attempts at all
    expect(f.callCount()).toBe(0);
  });

  it('respects CAIA_EVENT_BUS_DB_PATH env override', () => {
    const f = makeFakeFactory();
    const m = new LazyMentor({
      defaultDbPath: '/tmp/default.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any
    });
    m.getOrOpen({ CAIA_EVENT_BUS_DB_PATH: '/tmp/override.sqlite' });
    expect(f.lastDbPath()).toBe('/tmp/override.sqlite');
  });

  it('throttles warning logs to at most one per warnIntervalMs', () => {
    const f = makeFakeFactory({ failOnceCount: Number.MAX_SAFE_INTEGER });
    const warns: string[] = [];
    let now = 1000;
    const m = new LazyMentor({
      defaultDbPath: '/tmp/x.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any,
      warn: (msg) => warns.push(msg),
      now: () => now,
      warnIntervalMs: 10_000
    });
    m.getOrOpen({}); // t=1000 → first warn
    m.getOrOpen({}); // t=1000 → suppressed
    now = 5000;
    m.getOrOpen({}); // t=5000 → still inside 10s window → suppressed
    now = 12_000;
    m.getOrOpen({}); // t=12000 → 11s elapsed → second warn
    now = 13_000;
    m.getOrOpen({}); // t=13000 → 1s elapsed since last → suppressed
    expect(warns.length).toBe(2);
    expect(f.callCount()).toBeGreaterThan(2); // open is retried each time
  });

  it('emit returns false when mentor is unavailable', () => {
    const f = makeFakeFactory({ failOnceCount: Number.MAX_SAFE_INTEGER });
    const m = new LazyMentor({
      defaultDbPath: '/tmp/x.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any,
      warn: (): void => undefined
    });
    expect(
      m.emit('PRMerged', {
        prNumber: 1,
        sha: 'a'.repeat(40),
        branch: 'develop'
      })
    ).toBe(false);
  });

  it('emit returns true and forwards to mentor on success', () => {
    const f = makeFakeFactory();
    const m = new LazyMentor({
      defaultDbPath: '/tmp/x.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any
    });
    const ok = m.emit('PRMerged', {
      prNumber: 99,
      sha: 'b'.repeat(40),
      branch: 'develop'
    });
    expect(ok).toBe(true);
    const calls = f.emitCalls();
    expect(calls.length).toBe(1);
    expect(calls[0]?.[0]).toBe('PRMerged');
  });

  it('emit swallows errors from underlying mentor.emit (returns false)', () => {
    const f = makeFakeFactory({ emitThrows: true });
    const warns: string[] = [];
    const m = new LazyMentor({
      defaultDbPath: '/tmp/x.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any,
      warn: (msg) => warns.push(msg)
    });
    const ok = m.emit('PRMerged', {
      prNumber: 1,
      sha: 'c'.repeat(40),
      branch: 'develop'
    });
    expect(ok).toBe(false);
    expect(warns.some((w) => w.includes('mentor emit threw'))).toBe(true);
  });

  it('_resetForTest clears cache so next getOrOpen retries', () => {
    const f = makeFakeFactory();
    const m = new LazyMentor({
      defaultDbPath: '/tmp/x.sqlite',
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      clientFactory: f.factory as unknown as any
    });
    m.getOrOpen({});
    expect(f.callCount()).toBe(1);
    m._resetForTest();
    m.getOrOpen({});
    expect(f.callCount()).toBe(2);
  });
});
