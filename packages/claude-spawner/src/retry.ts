/**
 * @chiefaia/claude-spawner — retry/backoff wrapper.
 *
 * Adds the `withRetry(fn, opts)` helper that wraps any async function
 * (typically `spawnClaude` or a higher-level caller that returns a
 * `SpawnClaudeResult`) with exponential backoff + jitter and per-attempt
 * OTel spans.
 *
 * Why this lives here (B7, 2026-05-31)
 *
 *   Phase B task B7 calls for the wizard's three Claude-spawning routes
 *   to gain a uniform retry/backoff envelope (3 retries, jitter,
 *   30s/60s/120s base delays). Per the reuse-first rule we extend
 *   `@chiefaia/claude-spawner` — the canonical spawner — rather than
 *   add a sibling wizard-side wrapper that would inevitably drift from
 *   what the verifier / code-reviewer / critic packages use when they
 *   adopt the same envelope in later phases.
 *
 * Subscription-only contract
 *
 *   The retry envelope does NOT introduce any new HTTP client or
 *   change the binary path. It only re-invokes the supplied function
 *   after a delay. The auth-key scrub still happens inside `spawnClaude`
 *   on every attempt; there is no escape hatch.
 *
 * Backoff schedule (defaults)
 *
 *   - attempt 1 fires immediately.
 *   - on failure, sleep `baseDelayMs * factor^(attempt-1)` with
 *     `±jitterPct` random jitter, then retry.
 *   - defaults: baseDelayMs=30_000, factor=2, jitterPct=0.2, maxRetries=3.
 *     → roughly 30s / 60s / 120s delays between attempts.
 *
 *   The sleep uses `setTimeout` (cancellable via AbortSignal) — we never
 *   block the event loop with a sync sleep.
 *
 * Error classification
 *
 *   `defaultClassifyError(outcome)` returns one of:
 *     - 'transient'  → retry
 *     - 'auth'       → DO NOT retry (401/403/oauth-expired/etc.)
 *     - 'constraint' → DO NOT retry (SpawnClaudeConstraintError)
 *     - 'fatal'      → DO NOT retry (operator-cancelled via AbortSignal)
 *
 * Progress events
 *
 *   `onAttempt` fires BEFORE each attempt; `onRetry` fires AFTER a
 *   failure that will be retried; `onFinal` fires once at the end.
 *   Wizard routes wire these to the per-project progress channel so
 *   the UI can render "Retrying in 60s (attempt 2/4)".
 */

import { createTracer } from '@chiefaia/tracing';
import { SpawnClaudeConstraintError, type SpawnClaudeResult } from './spawn.js';

const tracer = createTracer('@chiefaia/claude-spawner.retry');

/** Classification of a failed attempt. */
export type RetryErrorClass = 'transient' | 'auth' | 'constraint' | 'fatal';

/** Outcome shape callers must return from the wrapped function. */
export interface RetryAttemptOutcome<T> {
  ok: boolean;
  value?: T;
  error?: unknown;
}

/** Lift a `SpawnClaudeResult` into a `RetryAttemptOutcome`. */
export function fromSpawnResult(
  result: SpawnClaudeResult,
): RetryAttemptOutcome<SpawnClaudeResult> {
  if (result.ok) return { ok: true, value: result };
  return { ok: false, value: result, error: new Error(result.diagnostic ?? 'spawn failed') };
}

export interface RetryProgressEvent {
  attempt: number;
  totalAttempts: number;
  nextDelayMs: number;
  errorClass?: RetryErrorClass;
  lastError?: string;
}

export interface WithRetryOptions<T> {
  maxRetries?: number;
  baseDelayMs?: number;
  factor?: number;
  jitterPct?: number;
  random?: () => number;
  signal?: AbortSignal;
  classifyError?: (outcome: RetryAttemptOutcome<T>) => RetryErrorClass;
  onAttempt?: (event: RetryProgressEvent) => void;
  onRetry?: (event: RetryProgressEvent) => void;
  onFinal?: (event: RetryProgressEvent) => void;
  sleepFn?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export interface WithRetryResult<T> {
  ok: boolean;
  value?: T;
  attemptsRun: number;
  diagnostic: string | null;
  finalErrorClass: RetryErrorClass | null;
  aborted: boolean;
}

/**
 * Default classifier — inspects the outcome's error/result and returns
 * a `RetryErrorClass`. Auth / constraint failures are NOT retried;
 * everything else is treated as transient (favour retry over silent
 * give-up).
 */
export function defaultClassifyError(outcome: RetryAttemptOutcome<unknown>): RetryErrorClass {
  if (outcome.ok) return 'transient';
  const err = outcome.error;
  if (err instanceof SpawnClaudeConstraintError) return 'constraint';
  const messages: string[] = [];
  if (err instanceof Error) messages.push(err.message);
  else if (typeof err === 'string') messages.push(err);
  const val = outcome.value as { diagnostic?: string | null; stderr?: string } | undefined;
  if (val?.diagnostic) messages.push(val.diagnostic);
  if (val?.stderr) messages.push(val.stderr.slice(-500));
  const joined = messages.join(' | ');

  if (/api_error_status=(401|403)\b/.test(joined)) return 'auth';
  if (/api_error_status=(429|408|500|502|503|504)\b/.test(joined)) return 'transient';
  if (/authentication failed|unauthorized|invalid api key|oauth.*expired|not authenticated/i.test(joined)) {
    return 'auth';
  }
  if (/ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket hang up|fetch failed|timed out after|ENETUNREACH/i.test(joined)) {
    return 'transient';
  }
  return 'transient';
}

/** Strip env values and long stderr from a diagnostic before surfacing it. */
export function sanitizeDiagnostic(raw: unknown): string {
  let text = '';
  if (raw instanceof Error) text = raw.message;
  else if (typeof raw === 'string') text = raw;
  else if (raw === undefined || raw === null) text = '';
  else {
    try {
      text = JSON.stringify(raw);
    } catch {
      text = String(raw);
    }
  }
  text = text.replace(/(sk-[A-Za-z0-9_-]{8,})/g, 'sk-***');
  text = text.replace(/(Bearer\s+[A-Za-z0-9._-]{8,})/gi, 'Bearer ***');
  if (text.length > 400) text = `${text.slice(0, 400)}...`;
  return text;
}

/** Compute the delay before attempt `n+1` (n is the just-failed 1-indexed attempt). */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  factor: number,
  jitterPct: number,
  random: () => number,
): number {
  if (attempt < 1) return 0;
  const base = baseDelayMs * Math.pow(factor, attempt - 1);
  const jitterRange = 2 * jitterPct * random() - jitterPct;
  const withJitter = base * (1 + jitterRange);
  return Math.max(0, Math.round(withJitter));
}

/** Cancellable timer-based sleep. */
export function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const timer = setTimeout(() => {
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      reject(new Error('aborted'));
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Wrap an async function with exponential-backoff + jitter retry.
 *
 * Every attempt is wrapped in a `claude.retry.attempt` OTel span with
 * attributes `caia.retry.attempt`, `caia.retry.total_attempts`,
 * `caia.retry.error_class`. The retry-or-give-up decision uses
 * `classifyError` (defaults to {@link defaultClassifyError}).
 */
export async function withRetry<T>(
  fn: () => Promise<RetryAttemptOutcome<T>>,
  opts: WithRetryOptions<T> = {},
): Promise<WithRetryResult<T>> {
  const maxRetries = opts.maxRetries ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 30_000;
  const factor = opts.factor ?? 2;
  const jitterPct = opts.jitterPct ?? 0.2;
  const random = opts.random ?? Math.random;
  const classify = opts.classifyError ?? defaultClassifyError;
  const sleep = opts.sleepFn ?? defaultSleep;
  const totalAttempts = maxRetries + 1;

  let lastOutcome: RetryAttemptOutcome<T> | null = null;
  let lastErrorClass: RetryErrorClass | null = null;
  let lastDiagnostic: string | null = null;
  let attemptsRun = 0;
  let aborted = false;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    if (opts.signal?.aborted) {
      aborted = true;
      lastErrorClass = 'fatal';
      if (lastDiagnostic === null) lastDiagnostic = 'aborted before attempt';
      break;
    }

    opts.onAttempt?.({
      attempt,
      totalAttempts,
      nextDelayMs: 0,
      ...(lastErrorClass !== null ? { errorClass: lastErrorClass } : {}),
      ...(lastDiagnostic !== null ? { lastError: lastDiagnostic } : {}),
    });

    const outcome = await tracer.withSpan('claude.retry.attempt', async (span) => {
      span.setAttribute('caia.retry.attempt', attempt);
      span.setAttribute('caia.retry.total_attempts', totalAttempts);
      let result: RetryAttemptOutcome<T>;
      try {
        result = await fn();
      } catch (err) {
        result = { ok: false, error: err };
      }
      if (result.ok) {
        span.setAttribute('caia.retry.error_class', 'none');
        return result;
      }
      const cls = classify(result);
      span.setAttribute('caia.retry.error_class', cls);
      span.setStatus('error', sanitizeDiagnostic(result.error ?? result.value));
      return result;
    });

    attemptsRun = attempt;
    lastOutcome = outcome;

    if (outcome.ok) {
      opts.onFinal?.({
        attempt,
        totalAttempts,
        nextDelayMs: 0,
      });
      return {
        ok: true,
        ...(outcome.value !== undefined ? { value: outcome.value } : {}),
        attemptsRun: attempt,
        diagnostic: null,
        finalErrorClass: null,
        aborted: false,
      };
    }

    const cls = classify(outcome);
    lastErrorClass = cls;
    lastDiagnostic = sanitizeDiagnostic(outcome.error ?? outcome.value);

    const isLastAttempt = attempt >= totalAttempts;
    const isNonRetryable = cls === 'auth' || cls === 'constraint' || cls === 'fatal';

    if (isNonRetryable || isLastAttempt) {
      opts.onFinal?.({
        attempt,
        totalAttempts,
        nextDelayMs: 0,
        errorClass: cls,
        lastError: lastDiagnostic,
      });
      break;
    }

    const nextDelayMs = computeBackoffDelay(attempt, baseDelayMs, factor, jitterPct, random);
    opts.onRetry?.({
      attempt,
      totalAttempts,
      nextDelayMs,
      errorClass: cls,
      lastError: lastDiagnostic,
    });
    try {
      await sleep(nextDelayMs, opts.signal);
    } catch {
      aborted = true;
      lastErrorClass = 'fatal';
      if (lastDiagnostic === null) lastDiagnostic = 'aborted during backoff';
      break;
    }
  }

  const lastValue = lastOutcome?.value;
  return {
    ok: false,
    ...(lastValue !== undefined ? { value: lastValue } : {}),
    attemptsRun,
    diagnostic: lastDiagnostic,
    finalErrorClass: lastErrorClass,
    aborted,
  };
}
