/**
 * @chiefaia/playwright-config/pool
 *
 * Browserless connection pool + retry wrapper for the Fix-It Test
 * Agent (FIX-011).
 *
 * Why a pool:
 *   - The Fix-It runner (FIX-003) executes hundreds of generated story
 *     specs back-to-back. Each spec opens a Playwright browser via
 *     `chromium.connect()`, runs, and closes. Naively re-opening the
 *     remote Browserless WS handshake for every spec adds ~80–150 ms
 *     of CDP-handshake latency per test — adds up to minutes per
 *     thousand specs.
 *   - The pool keeps a small set of warm `Browser` handles around;
 *     consumers `lease()` one, run their work, `release()` it, and
 *     the next consumer reuses it.
 *
 * Why a retry wrapper:
 *   - Remote Chromium occasionally crashes — bad page, OOM, kernel
 *     panic on the host. The error surface from Playwright is a
 *     `BrowserClosedError` or a `ECONNRESET`/`socket hang up`. We
 *     classify these as transient and reconnect once before failing.
 *   - Non-transient errors (assertion failure, selector timeout,
 *     etc.) propagate immediately — no point retrying them.
 *
 * Mode gating:
 *   - The Fix-It runner switches between `local` and `browserless`
 *     mode on every job (CI/batch → browserless, dev/local → local
 *     Playwright workers from FIX-010). This module is consumed only
 *     in browserless mode; the runner short-circuits in local mode
 *     because Playwright's own worker pool already reuses browsers.
 *
 * Usage:
 *
 *   import { createBrowserlessPool } from '@chiefaia/playwright-config/pool';
 *
 *   const pool = createBrowserlessPool({
 *     wsEndpoint: process.env.BROWSERLESS_WS_ENDPOINT!,
 *     token: process.env.BROWSERLESS_TOKEN!,
 *     maxBrowsers: 4,
 *   });
 *
 *   const result = await pool.run(async (browser) => {
 *     const page = await (await browser.newContext()).newPage();
 *     await page.goto(...);
 *     return doStuff(page);
 *   });
 *
 *   await pool.dispose();   // tear down all browsers at end of run
 */

import { chromium, type Browser } from 'playwright';

/** Options for {@link createBrowserlessPool}. */
export interface BrowserlessPoolOptions {
  /**
   * WS endpoint, e.g.
   * the Browserless playwright endpoint URL (internal LAN only).
   * Token is appended automatically if {@link token} is set and the
   * URL doesn't already carry one.
   */
  wsEndpoint: string;

  /**
   * Auth token. Read from `BROWSERLESS_TOKEN` env if omitted. If the
   * pool can't find a token at construction time it throws — there is
   * no scenario where Browserless should be running unauthenticated.
   */
  token?: string;

  /**
   * Maximum number of warm browsers to keep alive simultaneously.
   * Default 4. Scale with the per-shard worker count in CI; with N
   * shards × 4 browsers each on a 30-session farm we leave 14
   * sessions of headroom for ad-hoc work.
   */
  maxBrowsers?: number;

  /**
   * Number of times to retry on a transient connect/run error before
   * giving up. Default 1 (one retry, two attempts total). Higher
   * values mask real bugs; lower values fail noisily on the first
   * flake.
   */
  retries?: number;

  /** Connect timeout per attempt, ms. Default 15 000. */
  connectTimeoutMs?: number;

  /**
   * Hook for tests + dashboards. Fires after every successful lease,
   * release, retry, and dispose. Never throws — failures are caught
   * and logged.
   */
  onEvent?: (event: PoolEvent) => void;

  /**
   * Optional override of the connect function. Tests use this to
   * replace `chromium.connect` with an in-memory stub. Production
   * never sets it.
   */
  connect?: (url: string, opts: { timeout: number }) => Promise<Browser>;
}

/** Events emitted by the pool. */
export type PoolEvent =
  | { type: 'lease'; warmCount: number }
  | { type: 'release'; warmCount: number }
  | { type: 'connect-success'; attempt: number }
  | { type: 'connect-fail'; attempt: number; error: string; retrying: boolean }
  | { type: 'browser-crashed'; reason: string }
  | { type: 'dispose'; closedCount: number };

/** The pool handle returned by {@link createBrowserlessPool}. */
export interface BrowserlessPool {
  /**
   * Lease a browser from the pool, run the callback, return the
   * browser to the pool. If the browser crashes during the callback,
   * the pool reconnects and retries up to `retries` times. If the
   * callback throws a non-transient error, the browser is released
   * unchanged and the error propagates.
   */
  run<T>(fn: (browser: Browser) => Promise<T>): Promise<T>;

  /** Number of browsers currently warm (idle + leased). */
  size(): number;

  /** Number of browsers currently leased to consumers. */
  leased(): number;

  /**
   * Close all browsers and reject any in-flight `run()` calls.
   * Idempotent.
   */
  dispose(): Promise<void>;
}

// ---------------------------------------------------------------------------
// implementation
// ---------------------------------------------------------------------------

interface PoolEntry {
  browser: Browser;
  /** Currently checked out by a consumer. */
  leased: boolean;
  /** Browser is alive (no close event seen). */
  alive: boolean;
  /**
   * Set true just before we intentionally call close() so the
   * 'disconnected' listener can distinguish a clean teardown from a
   * crash.
   */
  expectClose: boolean;
}

class TransientBrowserError extends Error {
  public override readonly cause: unknown;
  constructor(message: string, cause: unknown) {
    super(message);
    this.name = 'TransientBrowserError';
    this.cause = cause;
  }
}

const TRANSIENT_PATTERNS: readonly RegExp[] = [
  /Target page, context or browser has been closed/i,
  /BrowserClosedError/i,
  /Browser has been closed/i,
  /WebSocket( error|is closed| connection( was)? lost)/i,
  /ECONNRESET/i,
  /ECONNREFUSED/i,
  /socket hang up/i,
  /protocol error.*Target closed/i,
];

/**
 * Returns true when the error looks like a remote-browser crash or
 * connection failure that's worth retrying.
 *
 * Exported for tests and for the dashboard's failure-classification
 * panel.
 */
export function isTransientBrowserError(err: unknown): boolean {
  if (err instanceof TransientBrowserError) return true;
  const msg = err instanceof Error ? err.message : String(err);
  return TRANSIENT_PATTERNS.some((p) => p.test(msg));
}

/**
 * Build the WS URL with token appended if necessary. Exported for
 * tests.
 */
export function buildPoolWsEndpoint(
  endpoint: string,
  token: string | undefined,
): string {
  if (!token) return endpoint;
  if (/[?&]token=/.test(endpoint)) return endpoint;
  const sep = endpoint.includes('?') ? '&' : '?';
  return `${endpoint}${sep}token=${encodeURIComponent(token)}`;
}

/**
 * Create a Browserless connection pool.
 */
export function createBrowserlessPool(
  opts: BrowserlessPoolOptions,
): BrowserlessPool {
  const token = opts.token ?? process.env['BROWSERLESS_TOKEN'];
  if (!token) {
    throw new Error(
      'createBrowserlessPool: token is required; set BROWSERLESS_TOKEN or pass opts.token',
    );
  }
  const url = buildPoolWsEndpoint(opts.wsEndpoint, token);
  const maxBrowsers = clampMaxBrowsers(opts.maxBrowsers ?? 4);
  const retries = opts.retries ?? 1;
  const connectTimeout = opts.connectTimeoutMs ?? 15_000;
  const onEvent = opts.onEvent ?? noop;
  const connect = opts.connect ?? defaultConnect;

  const entries: PoolEntry[] = [];
  let disposed = false;
  // Pending queue for `run()` callers waiting for a free browser.
  const waiters: Array<(entry: PoolEntry) => void> = [];

  function emit(event: PoolEvent): void {
    try {
      onEvent(event);
    } catch {
      // Hook errors must never disrupt the pool.
    }
  }

  async function connectOnce(): Promise<Browser> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const b = await connect(url, { timeout: connectTimeout });
        emit({ type: 'connect-success', attempt });
        return b;
      } catch (err) {
        lastErr = err;
        const retrying = attempt < retries;
        emit({
          type: 'connect-fail',
          attempt,
          error: (err as Error).message,
          retrying,
        });
        if (!retrying) break;
      }
    }
    throw new TransientBrowserError(
      `failed to connect to Browserless after ${retries + 1} attempts: ${(lastErr as Error)?.message}`,
      lastErr,
    );
  }

  async function acquire(): Promise<PoolEntry> {
    if (disposed) {
      throw new Error('pool is disposed');
    }
    // Reuse a warm idle browser if any.
    const idle = entries.find((e) => e.alive && !e.leased);
    if (idle) {
      idle.leased = true;
      emit({ type: 'lease', warmCount: entries.length });
      return idle;
    }
    // Open a new one if under cap.
    if (entries.length < maxBrowsers) {
      const browser = await connectOnce();
      const entry: PoolEntry = { browser, leased: true, alive: true, expectClose: false };
      browser.on('disconnected', () => {
        entry.alive = false;
        if (!entry.expectClose) {
          emit({ type: 'browser-crashed', reason: 'browser disconnected' });
        }
        // Flush from pool.
        const idx = entries.indexOf(entry);
        if (idx >= 0) entries.splice(idx, 1);
      });
      entries.push(entry);
      emit({ type: 'lease', warmCount: entries.length });
      return entry;
    }
    // At cap; wait for a release.
    return new Promise<PoolEntry>((resolve) => {
      waiters.push(resolve);
    });
  }

  function release(entry: PoolEntry): void {
    entry.leased = false;
    if (!entry.alive) {
      // Drop dead entries on release; they were already removed from
      // `entries` by the disconnect handler.
      return;
    }
    emit({ type: 'release', warmCount: entries.length });
    const next = waiters.shift();
    if (next) {
      entry.leased = true;
      next(entry);
    }
  }

  async function run<T>(fn: (browser: Browser) => Promise<T>): Promise<T> {
    let attempt = 0;
    let lastErr: unknown;
    // We retry only when the failure looks transient. A non-transient
    // error from `fn` (assertion, selector timeout) propagates on the
    // first try.
    while (attempt <= retries) {
      const entry = await acquire();
      try {
        const result = await fn(entry.browser);
        release(entry);
        return result;
      } catch (err) {
        lastErr = err;
        // Mark the entry dead on any error so we don't hand a poisoned
        // browser to the next caller. The disconnect handler will
        // clean it up; if it's still alive, force-close.
        if (entry.alive) {
          entry.expectClose = true;
          try {
            await entry.browser.close();
          } catch {
            // ignore
          }
          entry.alive = false;
          const idx = entries.indexOf(entry);
          if (idx >= 0) entries.splice(idx, 1);
        }
        if (!isTransientBrowserError(err)) throw err;
        attempt += 1;
        if (attempt > retries) break;
        emit({
          type: 'connect-fail',
          attempt,
          error: (err as Error).message,
          retrying: true,
        });
      }
    }
    throw lastErr;
  }

  async function dispose(): Promise<void> {
    if (disposed) return;
    disposed = true;
    const toClose = entries.splice(0);
    for (const e of toClose) {
      e.expectClose = true;
      try {
        await e.browser.close();
      } catch {
        // ignore
      }
    }
    // Reject anyone still waiting.
    for (const w of waiters.splice(0)) {
      Promise.resolve().then(() => {
        w({ browser: null as unknown as Browser, leased: false, alive: false, expectClose: true });
      });
    }
    emit({ type: 'dispose', closedCount: toClose.length });
  }

  return {
    run,
    size: () => entries.length,
    leased: () => entries.filter((e) => e.leased).length,
    dispose,
  };
}

function defaultConnect(
  url: string,
  opts: { timeout: number },
): Promise<Browser> {
  return chromium.connect(url, opts);
}

function noop(): void {
  /* no-op */
}

function clampMaxBrowsers(n: number): number {
  if (!Number.isFinite(n) || n < 1) return 1;
  if (n > 16) return 16;
  return Math.floor(n);
}
