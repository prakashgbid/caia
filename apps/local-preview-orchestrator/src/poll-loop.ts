/**
 * Polling daemon for local preview deploys.
 *
 * Runs continuously inside a LaunchAgent (`com.stolution.local-preview.deploy-daemon`).
 * Every `intervalMs` (default 30s):
 *   1. For each configured site, check the per-site cooldown:
 *      - if cooldownUntil > now, skip with `{status: 'cooling-down', cooldownRemainingMs: N}`
 *      - else kick off a `deploySite()` if no deploy is already in flight
 *   2. The deploy itself does the cheap noop short-circuit (git fetch + SHA
 *      compare); we don't filter at the loop level.
 *   3. Update the failure tracker based on the deploy outcome:
 *      - failure → increment `consecutive[site]`, set
 *        `cooldownUntil[site] = now + min(2^N * baseMs, capMs)`
 *      - success / noop → reset both
 *      - locked / in-progress / cooling-down → no change
 *   4. Sleep for the interval; repeat.
 *
 * Coalescing: deploys for the same site are serialised by the in-process
 * lock acquired inside `deploySite`; if a deploy is already running when the
 * next iteration ticks, that site is skipped this round and re-evaluated next
 * round (which always operates on the freshest origin/<branch>, so latest-wins).
 *
 * Backoff (PR-F): the cooldown table above prevents the tight 30s retry
 * burn observed during Stage-6 verify when a site's build kept failing. The
 * deploy daemon still ticks every 30s; sites in cooldown report
 * `cooling-down` status until their backoff window elapses.
 *
 * Trust boundary: all paths and configs derive from the compile-time SITES
 * registry; no user-controllable input enters this module.
 */

import { deploySite, type DeployOptions, type DeployResult } from './deploy.js';
import type { SiteConfig } from './sites-config.js';

export interface PollLoopOptions {
  /** Sites to monitor. */
  sites: SiteConfig[];
  /** Deploy options passed through to deploySite() per iteration. */
  deployOptions: DeployOptions;
  /** Polling interval in ms. Default 30s. */
  intervalMs?: number;
  /** AbortSignal for graceful shutdown. */
  abortSignal?: AbortSignal;
  /** Override the deploy function (test injection). */
  deployFn?: (site: SiteConfig, opts: DeployOptions) => Promise<DeployResult>;
  /** Callback after each iteration with per-site outcomes. */
  onIteration?: (results: IterationResult) => void;
  /** Logger. */
  logger?: { info: (msg: string) => void; error: (msg: string, ctx?: unknown) => void };
  /** Sleep override (test injection). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  /** Stop after N iterations (testability). 0 / undefined = run forever. */
  maxIterations?: number;
  /** Backoff configuration. Defaults to base 30s, cap 30min. */
  backoff?: BackoffOptions;
  /** Failure tracker (test injection). */
  failureTracker?: FailureTracker;
  /** Clock injection for tests. */
  now?: () => number;
}

export interface BackoffOptions {
  /** Base interval used in `min(2^N * baseMs, capMs)`. Default 30_000. */
  baseMs?: number;
  /** Max cooldown. Default 30 * 60_000 = 30 min. */
  capMs?: number;
}

export interface FailureTracker {
  consecutive: Map<string, number>;
  cooldownUntil: Map<string, number>;
}

export type CoolingDown = { status: 'cooling-down'; cooldownRemainingMs: number };
export type IterationResult = Record<
  string,
  DeployResult | { status: 'in-progress' } | { status: 'error'; error: string } | CoolingDown
>;

const DEFAULT_INTERVAL_MS = 30_000;
const DEFAULT_BACKOFF_BASE_MS = 30_000;
const DEFAULT_BACKOFF_CAP_MS = 30 * 60_000;

const consoleLogger = {
  info: (msg: string): void => console.log(msg),
  error: (msg: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.error(msg, ctx);
    else console.error(msg);
  }
};

/**
 * Statuses that count as a failure for backoff purposes.
 *
 * `locked` is **not** a failure — it means another instance is in flight,
 * which is an internal-coordination outcome unrelated to upstream health.
 *
 * `in-progress` is also not a failure — it means we skipped this site this
 * iteration because we already kicked off a deploy in a prior tick that
 * hasn't returned yet.
 */
const FAILURE_STATUSES: ReadonlySet<string> = new Set([
  'build-failed',
  'health-check-failed',
  'rollback-failed',
  'disk-full',
  'aborted',
  'error'
]);

/**
 * Sleep for `ms` milliseconds, or until `signal` is aborted (whichever first).
 */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const handle = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(handle);
      cleanup();
      resolve();
    };
    const cleanup = (): void => {
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Compute the cooldown duration after the Nth consecutive failure.
 *
 * For N=1: `2^1 * baseMs` capped (i.e., 60s under defaults).
 * For N=2: `2^2 * baseMs` capped (120s).
 * ...
 * For large N: `capMs`.
 *
 * For N=0 (no failures yet): 0.
 */
export function computeBackoffMs(
  consecutiveFailures: number,
  opts: { baseMs?: number; capMs?: number } = {}
): number {
  if (consecutiveFailures <= 0) return 0;
  const baseMs = opts.baseMs ?? DEFAULT_BACKOFF_BASE_MS;
  const capMs = opts.capMs ?? DEFAULT_BACKOFF_CAP_MS;
  // 2^N * baseMs, but guard against overflow at N>50 by capping the exponent.
  const safeN = Math.min(consecutiveFailures, 30);
  const raw = Math.pow(2, safeN) * baseMs;
  return Math.min(raw, capMs);
}

/**
 * Create a fresh failure tracker. Each call returns a new pair of empty maps.
 */
export function createFailureTracker(): FailureTracker {
  return {
    consecutive: new Map(),
    cooldownUntil: new Map()
  };
}

/**
 * Update the failure tracker for one site based on its iteration outcome.
 * Pure-ish (mutates the tracker) — exported for testability.
 */
export function updateFailureTracker(
  tracker: FailureTracker,
  siteName: string,
  outcome: { status: string },
  now: number,
  backoff: BackoffOptions = {}
): void {
  const status = outcome.status;
  if (status === 'success' || status === 'noop') {
    tracker.consecutive.delete(siteName);
    tracker.cooldownUntil.delete(siteName);
    return;
  }
  if (FAILURE_STATUSES.has(status)) {
    const prev = tracker.consecutive.get(siteName) ?? 0;
    const next = prev + 1;
    tracker.consecutive.set(siteName, next);
    const cooldownMs = computeBackoffMs(next, backoff);
    tracker.cooldownUntil.set(siteName, now + cooldownMs);
    return;
  }
  // 'locked', 'in-progress', 'cooling-down', or anything else: no-op
}

/**
 * Run a single iteration: kick off deploys for any sites not already in flight
 * and not currently in their backoff cooldown.
 *
 * Site-level concurrency is enforced inside deploySite() (it returns
 * `{status: 'locked'}` if another invocation is in flight). We additionally
 * track in-flight sites here so the iteration callback reports `in-progress`
 * cleanly without duplicating the lock-failed status.
 */
export async function pollIteration(
  inFlight: Set<string>,
  opts: Pick<
    PollLoopOptions,
    'sites' | 'deployOptions' | 'deployFn' | 'logger' | 'failureTracker' | 'backoff' | 'now'
  >
): Promise<IterationResult> {
  const logger = opts.logger ?? consoleLogger;
  const deployFn = opts.deployFn ?? deploySite;
  const tracker = opts.failureTracker;
  const now = opts.now ?? Date.now;
  const result: IterationResult = {};

  await Promise.all(
    opts.sites.map(async (site) => {
      if (inFlight.has(site.name)) {
        result[site.name] = { status: 'in-progress' };
        return;
      }

      // Backoff gate: skip if we're still in the cooldown window from prior failures.
      if (tracker) {
        const cooldownUntil = tracker.cooldownUntil.get(site.name) ?? 0;
        const remaining = cooldownUntil - now();
        if (remaining > 0) {
          result[site.name] = { status: 'cooling-down', cooldownRemainingMs: remaining };
          return;
        }
      }

      inFlight.add(site.name);
      try {
        const r = await deployFn(site, opts.deployOptions);
        result[site.name] = r;
        if (tracker) {
          updateFailureTracker(tracker, site.name, r, now(), opts.backoff);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[poll-loop] deploy ${site.name} threw: ${msg}`);
        const errorOutcome = { status: 'error' as const, error: msg };
        result[site.name] = errorOutcome;
        if (tracker) {
          updateFailureTracker(tracker, site.name, errorOutcome, now(), opts.backoff);
        }
      } finally {
        inFlight.delete(site.name);
      }
    })
  );

  return result;
}

/**
 * Long-running poll loop. Returns when `abortSignal` fires or `maxIterations` is reached.
 */
export async function runPollLoop(opts: PollLoopOptions): Promise<void> {
  const interval = opts.intervalMs ?? DEFAULT_INTERVAL_MS;
  const sleep = opts.sleep ?? defaultSleep;
  const logger = opts.logger ?? consoleLogger;
  const inFlight = new Set<string>();
  const maxIterations = opts.maxIterations ?? 0;
  const failureTracker = opts.failureTracker ?? createFailureTracker();

  let iter = 0;
  logger.info(
    `[poll-loop] starting; sites=${opts.sites.map((s) => s.name).join(',')} intervalMs=${interval}`
  );

  while (!opts.abortSignal?.aborted) {
    iter++;
    const start = Date.now();
    let result: IterationResult;
    try {
      result = await pollIteration(inFlight, {
        sites: opts.sites,
        deployOptions: opts.deployOptions,
        ...(opts.deployFn !== undefined ? { deployFn: opts.deployFn } : {}),
        ...(opts.backoff !== undefined ? { backoff: opts.backoff } : {}),
        ...(opts.now !== undefined ? { now: opts.now } : {}),
        failureTracker,
        logger
      });
    } catch (err) {
      logger.error(`[poll-loop] iteration ${iter} threw`, err);
      result = {};
    }

    try {
      opts.onIteration?.(result);
    } catch (err) {
      logger.error(`[poll-loop] onIteration handler threw`, err);
    }

    const elapsed = Date.now() - start;
    logger.info(`[poll-loop] iteration ${iter} complete in ${elapsed}ms`);

    if (maxIterations > 0 && iter >= maxIterations) break;
    if (opts.abortSignal?.aborted) break;

    const remaining = Math.max(0, interval - elapsed);
    await sleep(remaining, opts.abortSignal);
  }

  logger.info(`[poll-loop] exiting after ${iter} iteration(s)`);
}
