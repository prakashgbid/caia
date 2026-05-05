/**
 * Lazy + retry-on-each-call wrapper around the Mentor event-bus client.
 *
 * Why this exists (PR-H, leg-4 stage-6 finding):
 * The local-preview deploy daemon is a long-running LaunchAgent. The first
 * implementation (PR-γ) eagerly opened the Mentor client at process boot;
 * if Mentor was installed AFTER local-preview, the boot-time open failed
 * and no future PRMerged event ever fired — even after Mentor was running
 * — until the daemon was restarted.
 *
 * The fix: open lazily, on each emit attempt, and cache once successful.
 * If a delayed Mentor install happens 2 hours into the daemon's life, the
 * very next successful deploy will see Mentor available and start emitting
 * without any restart. A single warning is logged per `WARN_INTERVAL_MS`
 * window to avoid log spam during the period before Mentor is installed.
 *
 * Trust boundary: the wrapper NEVER throws. The producer-non-blocking
 * invariant from PR-γ is preserved — Mentor unavailability must not block
 * deploy success.
 */

import {
  Client as MentorClient,
  type EventType,
  type PayloadOf
} from '@chiefaia/mentor-event-bus';

export interface LazyMentorOptions {
  /** Default DB path used when CAIA_EVENT_BUS_DB_PATH env var is unset. */
  defaultDbPath: string;
  /**
   * Override the client constructor (test injection). Defaults to a real
   * `new MentorClient(...)`.
   */
  clientFactory?: (opts: { dbPath: string; processName: string }) => MentorClient;
  /**
   * Override the warn function. Defaults to `console.warn`.
   */
  warn?: (msg: string) => void;
  /**
   * Override the clock. Defaults to `Date.now`.
   */
  now?: () => number;
  /**
   * Logger throttling window. Defaults to 5 minutes.
   */
  warnIntervalMs?: number;
}

/**
 * Lazy / retry singleton for the Mentor client.
 *
 * Methods:
 *   - `getOrOpen(env)`: returns a cached `MentorClient` if available, else
 *     attempts to open one. Returns undefined on failure or if disabled
 *     via `CAIA_EVENT_BUS_DISABLED=1`.
 *   - `emit(type, payload, env)`: convenience for fire-and-forget emit
 *     that calls `getOrOpen` and emits. Returns true if emitted, false if
 *     mentor was unavailable (caller can use this to no-op gracefully).
 */
export class LazyMentor {
  private client: MentorClient | undefined;
  private lastWarnedAt = 0;
  private readonly defaultDbPath: string;
  private readonly clientFactory: (opts: {
    dbPath: string;
    processName: string;
  }) => MentorClient;
  private readonly warn: (msg: string) => void;
  private readonly now: () => number;
  private readonly warnIntervalMs: number;

  constructor(opts: LazyMentorOptions) {
    this.defaultDbPath = opts.defaultDbPath;
    this.clientFactory =
      opts.clientFactory ??
      ((o): MentorClient => new MentorClient(o));
    this.warn = opts.warn ?? ((m: string): void => console.warn(m));
    this.now = opts.now ?? Date.now;
    this.warnIntervalMs = opts.warnIntervalMs ?? 5 * 60_000;
  }

  /**
   * Returns the open client, opening it lazily on first call (or after a
   * previously-failed open) if necessary.
   *
   * Returns undefined if:
   *   - `CAIA_EVENT_BUS_DISABLED=1` is set in env (opt-out)
   *   - the open fails for any reason (DB not found, permission denied,
   *     etc.) — a warning is logged at most once per `warnIntervalMs`.
   */
  getOrOpen(env: NodeJS.ProcessEnv = process.env): MentorClient | undefined {
    if (env['CAIA_EVENT_BUS_DISABLED'] === '1') return undefined;
    if (this.client !== undefined) return this.client;
    const dbPath = env['CAIA_EVENT_BUS_DB_PATH'] ?? this.defaultDbPath;
    try {
      this.client = this.clientFactory({
        dbPath,
        processName: 'local-preview-orchestrator'
      });
      return this.client;
    } catch (e) {
      const tNow = this.now();
      // First failed open always warns; subsequent failures throttled to
      // at most one per warnIntervalMs window. Tracked by
      // `lastWarnedAt === 0` (never warned) → unconditional warn.
      if (this.lastWarnedAt === 0 || tNow - this.lastWarnedAt > this.warnIntervalMs) {
        this.warn(
          `[local-preview] mentor client open failed (will retry; emit suppressed): ${String(e)}`
        );
        this.lastWarnedAt = tNow;
      }
      return undefined;
    }
  }

  /**
   * Fire-and-forget emit. Returns true if mentor was available and emit
   * was attempted (mentor's own `emit` swallows internal errors); false if
   * mentor was unavailable.
   */
  emit<T extends EventType>(
    type: T,
    payload: PayloadOf<T>,
    env: NodeJS.ProcessEnv = process.env
  ): boolean {
    const mentor = this.getOrOpen(env);
    if (!mentor) return false;
    try {
      mentor.emit(type, payload);
      return true;
    } catch (e) {
      // Defence in depth: mentor.emit shouldn't throw, but if it does we
      // still must not bubble it back into the deploy pipeline.
      this.warn(`[local-preview] mentor emit threw (ignored): ${String(e)}`);
      return false;
    }
  }

  /** Reset cached client. Test-only. */
  _resetForTest(): void {
    this.client = undefined;
    this.lastWarnedAt = 0;
  }
}
