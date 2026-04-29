// Resilience primitives for @chiefaia/local-llm-router — HARDEN-005.
//
// Three composable helpers that wrap any provider dispatch:
//
//   1. withTimeout(promise, ms, taskType)
//      Promise.race against a timer that rejects with TimeoutError so
//      callers can distinguish slow networks from upstream rejections.
//
//   2. withRetry(fn, attempts, baseDelayMs, isRetryable)
//      Exponential backoff: delays at 1x, 2x, 4x of baseDelayMs. By
//      default only TimeoutError + network errors retry; explicit
//      provider rejections (4xx-style) bubble immediately.
//
//   3. CircuitBreaker
//      Per-provider state machine: closed -> open after `failureThreshold`
//      consecutive failures; open -> half-open after `cooldownMs`; one
//      probe call decides closed-or-open again. Open state means new
//      calls fail fast with BreakerOpenError so the router can fall
//      back to the other provider without burning latency.
//
// Each helper is dependency-free + injectable now/setTimeout for tests.
//
// The router (router.ts) composes them in the order:
//   breaker.exec(() => withRetry(() => withTimeout(dispatch...)))
// so a single timeout doesn't burn the budget; the retry fires; only
// after all retries are exhausted is the failure counted by the breaker.

export class TimeoutError extends Error {
  constructor(public readonly taskType: string, public readonly timeoutMs: number) {
    super(`LLM call timed out after ${timeoutMs}ms (task=${taskType})`);
    this.name = 'TimeoutError';
  }
}

export class BreakerOpenError extends Error {
  constructor(public readonly provider: string) {
    super(`circuit breaker open for provider=${provider}`);
    this.name = 'BreakerOpenError';
  }
}

// ─── Timeout ────────────────────────────────────────────────────────────────

export function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  taskType: string,
  setTimeoutImpl: typeof setTimeout = setTimeout,
  clearTimeoutImpl: typeof clearTimeout = clearTimeout,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const handle = setTimeoutImpl(() => {
      reject(new TimeoutError(taskType, ms));
    }, ms);
    promise.then(
      (v) => { clearTimeoutImpl(handle); resolve(v); },
      (e) => { clearTimeoutImpl(handle); reject(e); },
    );
  });
}

// ─── Retry ──────────────────────────────────────────────────────────────────

export interface RetryOptions {
  attempts?: number;          // total attempts including the first; default 3
  baseDelayMs?: number;       // first backoff delay; default 250ms
  isRetryable?: (err: unknown) => boolean;
  /** Per-attempt callback for observability (logging/events). */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
  setTimeoutImpl?: typeof setTimeout;
}

const DEFAULT_RETRYABLE = (err: unknown): boolean => {
  if (err instanceof TimeoutError) return true;
  const msg = String((err as { message?: string })?.message ?? err);
  // Network-y error strings worth retrying.
  return /ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|fetch failed|network/i.test(msg);
};

export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, opts.attempts ?? 3);
  const baseDelay = Math.max(0, opts.baseDelayMs ?? 250);
  const isRetryable = opts.isRetryable ?? DEFAULT_RETRYABLE;
  const setTimeoutFn = opts.setTimeoutImpl ?? setTimeout;
  let lastErr: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const isLast = i === attempts - 1;
      if (isLast || !isRetryable(err)) throw err;
      const delayMs = baseDelay * Math.pow(2, i);
      opts.onRetry?.({ attempt: i + 1, delayMs, error: err });
      await new Promise<void>((r) => setTimeoutFn(() => r(), delayMs));
    }
  }
  throw lastErr;
}

// ─── Circuit breaker ────────────────────────────────────────────────────────

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  /** Consecutive failures that flip closed -> open. Default 5. */
  failureThreshold?: number;
  /** Milliseconds before open -> half-open. Default 30_000. */
  cooldownMs?: number;
  /** Override Date.now (tests). */
  now?: () => number;
  /** Notification hook for state transitions (observability). */
  onStateChange?: (info: { provider: string; from: BreakerState; to: BreakerState; ts: number }) => void;
}

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private consecutiveFailures = 0;
  private openedAt = 0;
  private readonly failureThreshold: number;
  private readonly cooldownMs: number;
  private readonly now: () => number;
  private readonly onStateChange?: BreakerOptions['onStateChange'];

  constructor(public readonly provider: string, opts: BreakerOptions = {}) {
    this.failureThreshold = opts.failureThreshold ?? 5;
    this.cooldownMs = opts.cooldownMs ?? 30_000;
    this.now = opts.now ?? Date.now;
    this.onStateChange = opts.onStateChange;
  }

  /** Wraps a call. Throws BreakerOpenError when fast-failing. */
  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      // Maybe transition to half-open.
      if (this.now() - this.openedAt >= this.cooldownMs) {
        this.transition('half-open');
      } else {
        throw new BreakerOpenError(this.provider);
      }
    }
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure();
      throw err;
    }
  }

  /** Current state for tests / dashboards. */
  getState(): BreakerState { return this.state; }
  getConsecutiveFailures(): number { return this.consecutiveFailures; }

  /** Reset internal counters (admin use). */
  reset(): void {
    if (this.state !== 'closed') this.transition('closed');
    this.consecutiveFailures = 0;
  }

  // ─── internals ──────────────────────────────────────────────────────────

  private onSuccess(): void {
    if (this.state === 'half-open' || this.consecutiveFailures > 0) {
      this.transition('closed');
    }
    this.consecutiveFailures = 0;
  }

  private onFailure(): void {
    this.consecutiveFailures++;
    if (this.state === 'half-open' || this.consecutiveFailures >= this.failureThreshold) {
      this.openedAt = this.now();
      this.transition('open');
    }
  }

  private transition(to: BreakerState): void {
    if (this.state === to) return;
    const from = this.state;
    this.state = to;
    if (to === 'closed') this.consecutiveFailures = 0;
    this.onStateChange?.({ provider: this.provider, from, to, ts: this.now() });
  }
}
