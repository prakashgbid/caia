/**
 * Polling daemon for local preview deploys.
 *
 * Runs continuously inside a LaunchAgent (`com.stolution.local-preview.deploy-daemon`).
 * Every `intervalMs` (default 30s):
 *   1. For each configured site, kick off a `deploySite()` if no deploy is
 *      already in flight for that site.
 *   2. The deploy itself does the cheap noop short-circuit (git fetch + SHA
 *      compare); we don't filter at the loop level.
 *   3. Sleep for the interval; repeat.
 *
 * Coalescing: deploys for the same site are serialised by the in-process
 * lock acquired inside `deploySite`; if a deploy is already running when the
 * next iteration ticks, that site is skipped this round and re-evaluated next
 * round (which always operates on the freshest origin/<branch>, so latest-wins).
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
}

export type IterationResult = Record<string, DeployResult | { status: 'in-progress' } | { status: 'error'; error: string }>;

const DEFAULT_INTERVAL_MS = 30_000;

const consoleLogger = {
  info: (msg: string): void => console.log(msg),
  error: (msg: string, ctx?: unknown): void => {
    if (ctx !== undefined) console.error(msg, ctx);
    else console.error(msg);
  }
};

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
 * Run a single iteration: kick off deploys for any sites not already in flight.
 *
 * Site-level concurrency is enforced inside deploySite() (it returns
 * `{status: 'locked'}` if another invocation is in flight). We additionally
 * track in-flight sites here so the iteration callback reports `in-progress`
 * cleanly without duplicating the lock-failed status.
 */
export async function pollIteration(
  inFlight: Set<string>,
  opts: Pick<PollLoopOptions, 'sites' | 'deployOptions' | 'deployFn' | 'logger'>
): Promise<IterationResult> {
  const logger = opts.logger ?? consoleLogger;
  const deployFn = opts.deployFn ?? deploySite;
  const result: IterationResult = {};

  await Promise.all(
    opts.sites.map(async (site) => {
      if (inFlight.has(site.name)) {
        result[site.name] = { status: 'in-progress' };
        return;
      }
      inFlight.add(site.name);
      try {
        const r = await deployFn(site, opts.deployOptions);
        result[site.name] = r;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error(`[poll-loop] deploy ${site.name} threw: ${msg}`);
        result[site.name] = { status: 'error', error: msg };
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
