/**
 * TASK-001 enforcement — tracks whether `task_run_record` has been called
 * after every `start_task` / `start_code_task` invocation.
 *
 * This module does NOT make HTTP calls. It maintains an in-memory registry of
 * pending acknowledgements and records violations when the TTL expires without
 * a matching `recordSpawn` call.
 *
 * Time is injected via `setNow` to enable deterministic testing.
 *
 * @no-events — enforcement/tracking layer only; no domain events emitted.
 */

import type { TaskSpawnRecord, MiddlewareViolation } from './types.js';
import { TaskRunNotRecordedError } from './errors.js';

/** Default TTL in milliseconds before an unacknowledged spawn is flagged. */
const DEFAULT_TTL_MS = 30_000;

interface PendingEntry {
  kind: 'code' | 'task';
  spawnedAt: number; // ms epoch from injected clock
}

/** @no-events — pure tracking class; injected clock for testability. */
export class TaskRunLogger {
  private readonly pending = new Map<string, PendingEntry>();
  private readonly acknowledged = new Set<string>();
  private readonly violations: MiddlewareViolation[] = [];
  private readonly ttlMs: number;
  private nowFn: () => number;

  constructor(ttlMs: number = DEFAULT_TTL_MS) {
    this.ttlMs = ttlMs;
    this.nowFn = () => Date.now();
  }

  /**
   * Injects a custom clock function. Useful in tests to simulate time passage.
   *
   * @no-events
   */
  setNow(fn: () => number): void {
    this.nowFn = fn;
  }

  /**
   * Called immediately after `start_task` or `start_code_task` is dispatched.
   * Registers the session as pending acknowledgement.
   *
   * @no-events
   */
  notifySpawned(sessionId: string, kind: 'code' | 'task'): void {
    this.pending.set(sessionId, { kind, spawnedAt: this.nowFn() });
  }

  /**
   * Called when the orchestrator invokes `task_run_record` for a session.
   * Clears the pending entry and marks the session as acknowledged.
   *
   * @no-events
   * @param record - The full task spawn record received from the tool call.
   */
  recordSpawn(record: TaskSpawnRecord): void {
    this.pending.delete(record.sessionId);
    this.acknowledged.add(record.sessionId);
  }

  /**
   * Returns the session IDs of spawned tasks for which `task_run_record` has
   * not yet been called. Does NOT check TTL — call `checkTtlViolations` for that.
   *
   * @no-events
   */
  getPendingAcknowledgements(): string[] {
    return Array.from(this.pending.keys());
  }

  /**
   * Scans all pending entries and records a violation for any that have exceeded
   * the configured TTL. Expired entries are removed from the pending set.
   *
   * Safe to call repeatedly — violations are only recorded once per session ID.
   *
   * @no-events
   */
  checkTtlViolations(): void {
    const now = this.nowFn();

    for (const [sessionId, entry] of this.pending) {
      const elapsed = now - entry.spawnedAt;
      if (elapsed >= this.ttlMs) {
        this.pending.delete(sessionId);

        const error = new TaskRunNotRecordedError(sessionId, elapsed);
        this.violations.push({
          ruleId: 'TASK-001',
          severity: 'warn',
          message: error.message,
          context: { sessionId, kind: entry.kind, elapsedMs: elapsed, ttlMs: this.ttlMs },
          timestamp: new Date(now).toISOString(),
        });
      }
    }
  }

  /**
   * Returns all violations recorded so far (including TTL violations).
   *
   * @no-events
   */
  getViolations(): MiddlewareViolation[] {
    return [...this.violations];
  }

  /**
   * Resets all internal state. Intended for use between test cases.
   *
   * @no-events
   */
  reset(): void {
    this.pending.clear();
    this.acknowledged.clear();
    this.violations.length = 0;
  }
}
