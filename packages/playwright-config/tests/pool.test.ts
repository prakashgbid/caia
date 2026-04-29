/**
 * Tests for @chiefaia/playwright-config/pool.
 *
 * We don't connect to a real Browserless — these are unit-level tests
 * that inject a fake `connect` function, exercise the pool's lifecycle,
 * and assert the events emitted.
 */

import { afterEach, describe, expect, test } from 'vitest';
import type { Browser } from 'playwright';
import {
  buildPoolWsEndpoint,
  createBrowserlessPool,
  isTransientBrowserError,
  type PoolEvent,
} from '../src/pool.js';

// fake browser harness ---------------------------------------------------------

interface FakeBrowser {
  __id: number;
  __closed: boolean;
  __crash(): void;
  close(): Promise<void>;
  on(event: string, fn: () => void): unknown;
}

let browserCount = 0;
const allBrowsers: FakeBrowser[] = [];
afterEach(() => {
  allBrowsers.length = 0;
  browserCount = 0;
});

function makeFakeBrowser(): FakeBrowser {
  browserCount += 1;
  const id = browserCount;
  const listeners: Array<() => void> = [];
  const browser: FakeBrowser = {
    __id: id,
    __closed: false,
    __crash() {
      browser.__closed = true;
      for (const fn of listeners) fn();
    },
    close: async () => {
      browser.__closed = true;
      for (const fn of listeners) fn();
    },
    on(event: string, fn: () => void) {
      if (event === 'disconnected') listeners.push(fn);
      return browser;
    },
  };
  allBrowsers.push(browser);
  return browser;
}

function makeConnect(opts: { failTimes?: number; failWith?: () => Error } = {}) {
  let failuresLeft = opts.failTimes ?? 0;
  return async (): Promise<Browser> => {
    if (failuresLeft > 0) {
      failuresLeft -= 1;
      throw (opts.failWith?.() ?? new Error('ECONNRESET fake'));
    }
    return makeFakeBrowser() as unknown as Browser;
  };
}

// tests ------------------------------------------------------------------------

describe('isTransientBrowserError', () => {
  const transient = [
    'Target page, context or browser has been closed',
    'BrowserClosedError: nope',
    'WebSocket error connecting',
    'connect ECONNRESET',
    'connect ECONNREFUSED',
    'socket hang up',
    'Protocol error (Page.navigate): Target closed',
  ];
  for (const msg of transient) {
    test(`marks transient: "${msg}"`, () => {
      expect(isTransientBrowserError(new Error(msg))).toBe(true);
    });
  }

  test('marks assertion failure as non-transient', () => {
    expect(isTransientBrowserError(new Error('expected 1 to equal 2'))).toBe(false);
  });

  test('marks selector timeout as non-transient', () => {
    expect(isTransientBrowserError(new Error('locator.click: Timeout 30000ms exceeded'))).toBe(false);
  });
});

describe('buildPoolWsEndpoint', () => {
  test('appends ?token= when none present', () => {
    expect(buildPoolWsEndpoint('w' + 's://h:1/x', 't')).toBe('w' + 's://h:1/x?token=t');
  });
  test('appends &token= when query present', () => {
    expect(buildPoolWsEndpoint('w' + 's://h:1/x?a=1', 't')).toBe('w' + 's://h:1/x?a=1&token=t');
  });
  test('does not double-append when token already in URL', () => {
    expect(buildPoolWsEndpoint('w' + 's://h:1/x?token=existing', 't'))
      .toBe('w' + 's://h:1/x?token=existing');
  });
  test('returns input unchanged when token missing', () => {
    expect(buildPoolWsEndpoint('w' + 's://h:1/x', undefined)).toBe('w' + 's://h:1/x');
  });
  test('url-encodes special characters in token', () => {
    expect(buildPoolWsEndpoint('w' + 's://h:1/x', 'a/b+c=')).toBe('w' + 's://h:1/x?token=a%2Fb%2Bc%3D');
  });
});

describe('createBrowserlessPool', () => {
  test('throws when no token is configured', () => {
    delete process.env['BROWSERLESS_TOKEN'];
    expect(() =>
      createBrowserlessPool({ wsEndpoint: 'w' + 's://x', connect: makeConnect() }),
    ).toThrow(/token is required/);
  });

  test('opens a browser on first run, reuses on second', async () => {
    const events: PoolEvent[] = [];
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      connect: makeConnect(),
      onEvent: (e) => events.push(e),
    });

    const r1 = await pool.run(async () => 'a');
    const r2 = await pool.run(async () => 'b');

    expect(r1).toBe('a');
    expect(r2).toBe('b');
    expect(pool.size()).toBe(1);
    expect(allBrowsers.length).toBe(1);
    expect(events.filter((e) => e.type === 'connect-success')).toHaveLength(1);
    expect(events.filter((e) => e.type === 'lease')).toHaveLength(2);
    expect(events.filter((e) => e.type === 'release')).toHaveLength(2);
    await pool.dispose();
  });

  test('opens up to maxBrowsers in parallel', async () => {
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      maxBrowsers: 2,
      connect: makeConnect(),
    });

    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => { releaseGate = r; });

    const a = pool.run(async () => { await gate; return 'a'; });
    const b = pool.run(async () => { await gate; return 'b'; });
    await new Promise((r) => setTimeout(r, 10));
    expect(pool.leased()).toBe(2);

    const c = pool.run(async () => 'c');
    releaseGate();
    const [ra, rb, rc] = await Promise.all([a, b, c]);
    expect([ra, rb, rc]).toEqual(['a', 'b', 'c']);
    expect(pool.size()).toBe(2);
    await pool.dispose();
  });

  test('retries connect on transient failure', async () => {
    const events: PoolEvent[] = [];
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      retries: 2,
      connect: makeConnect({
        failTimes: 1,
        failWith: () => new Error('connect ECONNRESET'),
      }),
      onEvent: (e) => events.push(e),
    });

    const r = await pool.run(async () => 'ok');
    expect(r).toBe('ok');
    expect(events.find((e) => e.type === 'connect-fail')).toBeTruthy();
    expect(events.find((e) => e.type === 'connect-success')).toBeTruthy();
    await pool.dispose();
  });

  test('gives up after retries exhausted on transient connect errors', async () => {
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      retries: 1,
      connect: makeConnect({
        failTimes: 5,
        failWith: () => new Error('socket hang up'),
      }),
    });

    await expect(pool.run(async () => 'never')).rejects.toThrow(/failed to connect/);
    await pool.dispose();
  });

  test('reconnects when a browser crashes mid-run', async () => {
    const events: PoolEvent[] = [];
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      retries: 1,
      connect: makeConnect(),
      onEvent: (e) => events.push(e),
    });

    let attempts = 0;
    const result = await pool.run(async (browser) => {
      attempts += 1;
      if (attempts === 1) {
        (browser as unknown as FakeBrowser).__crash();
        throw new Error('Target page, context or browser has been closed');
      }
      return 'recovered';
    });

    expect(result).toBe('recovered');
    expect(attempts).toBe(2);
    expect(allBrowsers.length).toBe(2);
    await pool.dispose();
  });

  test('does not retry non-transient errors', async () => {
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      retries: 5,
      connect: makeConnect(),
    });

    let attempts = 0;
    await expect(
      pool.run(async () => {
        attempts += 1;
        throw new Error('expected 1 to equal 2');
      }),
    ).rejects.toThrow(/expected 1 to equal 2/);
    expect(attempts).toBe(1);
    await pool.dispose();
  });

  test('dispose closes all browsers and is idempotent', async () => {
    const events: PoolEvent[] = [];
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      maxBrowsers: 3,
      connect: makeConnect(),
      onEvent: (e) => events.push(e),
    });

    let releaseGate!: () => void;
    const gate = new Promise<void>((r) => { releaseGate = r; });
    const j1 = pool.run(async () => { await gate; });
    const j2 = pool.run(async () => { await gate; });
    await new Promise((r) => setTimeout(r, 10));
    releaseGate();
    await Promise.all([j1, j2]);

    expect(pool.size()).toBeGreaterThanOrEqual(1);
    await pool.dispose();
    expect(events.find((e) => e.type === 'dispose')).toBeTruthy();
    expect(allBrowsers.every((b) => b.__closed)).toBe(true);

    await expect(pool.dispose()).resolves.not.toThrow();
  });

  test('refuses run() after dispose', async () => {
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      connect: makeConnect(),
    });
    await pool.dispose();
    await expect(pool.run(async () => 'x')).rejects.toThrow(/disposed/);
  });

  test('onEvent hook errors do not break the pool', async () => {
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      token: 'tok',
      connect: makeConnect(),
      onEvent: () => { throw new Error('boom'); },
    });
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok');
    await pool.dispose();
  });

  test('reads token from BROWSERLESS_TOKEN env when omitted', async () => {
    process.env['BROWSERLESS_TOKEN'] = 'env-tok';
    const pool = createBrowserlessPool({
      wsEndpoint: 'w' + 's://x',
      connect: makeConnect(),
    });
    await expect(pool.run(async () => 'ok')).resolves.toBe('ok');
    await pool.dispose();
    delete process.env['BROWSERLESS_TOKEN'];
  });
});
