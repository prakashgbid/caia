// A.9.5 — claude_calls_per_hour budget guard.
//
// Hard cap on the number of `claude`-binary dispatches per rolling hour, to
// stop a runaway loop from burning the Max-20x subscription. Triggered for
// the 2026-05-11 burn incident where a flaky tool-use loop fanned out
// thousands of Claude calls inside a single chain phase.
//
// Default cap is 60/hour. Operators can override via env
// `CLAUDE_CALLS_PER_HOUR_CAP`. Setting it to `0` (or any value <= 0)
// disables the guard, useful for one-off bulk decomposition runs where
// the operator has explicitly accepted the spend.
//
// The guard is shared across all routes inside the daemon (singleton).
// Tests can construct a fresh `ClaudeCallBudget` to avoid singleton
// state-leaking.

const ENV_CAP_KEY = 'CLAUDE_CALLS_PER_HOUR_CAP';
const DEFAULT_CAP = 60;
const HOUR_MS = 60 * 60 * 1000;

/** Thrown when a Claude dispatch is refused by the per-hour cap. */
export class ClaudeBudgetExceededError extends Error {
  readonly cap: number;
  readonly callsInLastHour: number;
  readonly resetAt: number;

  constructor(opts: { cap: number; callsInLastHour: number; resetAt: number }) {
    const isoReset = new Date(opts.resetAt).toISOString();
    super(
      `Claude per-hour budget exceeded (cap=${String(opts.cap)}, ` +
        `seen=${String(opts.callsInLastHour)}). Next reset ~${isoReset}. ` +
        `Override with env CLAUDE_CALLS_PER_HOUR_CAP=<higher-number-or-0>, ` +
        `or wait for the rolling window to clear. ` +
        `Reason: A.9.5 guard prevents 2026-05-11-style runaway burn.`,
    );
    this.name = 'ClaudeBudgetExceededError';
    this.cap = opts.cap;
    this.callsInLastHour = opts.callsInLastHour;
    this.resetAt = opts.resetAt;
  }
}

export interface ClaudeCallBudgetOptions {
  /** Cap; values <= 0 disable the guard. Default reads env `CLAUDE_CALLS_PER_HOUR_CAP`, then 60. */
  cap?: number;
  /** Test seam — replace `Date.now`. */
  now?: () => number;
}

export class ClaudeCallBudget {
  private readonly cap: number;
  private readonly now: () => number;
  private readonly timestamps: number[] = [];

  constructor(opts: ClaudeCallBudgetOptions = {}) {
    this.cap = opts.cap ?? parseCapFromEnv();
    this.now = opts.now ?? Date.now;
  }

  /** Is the guard disabled (cap <= 0)? */
  get isDisabled(): boolean {
    return this.cap <= 0;
  }

  /** Configured cap. */
  get configuredCap(): number {
    return this.cap;
  }

  /**
   * Check whether one more Claude dispatch fits under the cap, and if so
   * record it. Throws `ClaudeBudgetExceededError` when the cap is hit.
   * Atomic — the record-on-success keeps multiple in-flight callers from
   * racing past the cap.
   */
  consume(): void {
    if (this.isDisabled) return;
    const t = this.now();
    this.evict(t);
    if (this.timestamps.length >= this.cap) {
      const oldest = this.timestamps[0] ?? t;
      throw new ClaudeBudgetExceededError({
        cap: this.cap,
        callsInLastHour: this.timestamps.length,
        resetAt: oldest + HOUR_MS,
      });
    }
    this.timestamps.push(t);
  }

  /** Snapshot for /metrics + diagnostics. */
  snapshot(): { cap: number; disabled: boolean; callsInLastHour: number; resetAt: number | null } {
    const t = this.now();
    this.evict(t);
    return {
      cap: this.cap,
      disabled: this.isDisabled,
      callsInLastHour: this.timestamps.length,
      resetAt:
        this.timestamps.length === 0 ? null : (this.timestamps[0] ?? t) + HOUR_MS,
    };
  }

  /** Test-only seam. */
  reset(): void {
    this.timestamps.length = 0;
  }

  private evict(now: number): void {
    const cutoff = now - HOUR_MS;
    while (this.timestamps.length > 0 && (this.timestamps[0] ?? 0) <= cutoff) {
      this.timestamps.shift();
    }
  }
}

function parseCapFromEnv(): number {
  const raw = process.env[ENV_CAP_KEY];
  if (raw === undefined || raw.trim() === '') return DEFAULT_CAP;
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return DEFAULT_CAP;
  return n;
}

/** Module-level singleton used by the router; tests construct their own. */
export const claudeCallBudget = new ClaudeCallBudget();
