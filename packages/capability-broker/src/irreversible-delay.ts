/**
 * Irreversible-action 5-second delay (per v2 §3.7).
 *
 * Before the executor calls the registered handler for any capability
 * with `irreversible: true`, the broker emits an `irreversible_pending`
 * event and waits a configurable delay (default 5_000 ms). During the
 * window the dashboard renders a Cancel button. If `cancel(tokenId)` is
 * called before the delay elapses, the handler is never invoked and the
 * execution is recorded to the ledger as `cancelled-by-operator`.
 *
 * 5 seconds is empirically enough for human reaction when watching the
 * dashboard. The delay is bypassable for reversible / rate-limited
 * capabilities, and configurable per-capability for emergencies.
 *
 * Reference: caia/docs/capability-broker.md §"Irreversible-action delay",
 * v2 §3.7.
 */

import type { CapabilityToken } from './types.js';

export interface IrreversibleDelayEvent {
  kind: 'pending' | 'cancelled' | 'committed';
  tokenId: string;
  capabilityName: CapabilityToken['name'];
  scope: string;
  taskId: string;
  /** Wall-clock when the event fired. */
  ts: number;
  /**
   * For `pending`: ms until the delay elapses (5000 default).
   * For `cancelled` / `committed`: 0.
   */
  remainingMs: number;
  /** Free-form reason captured at issuance time. */
  reason: string;
}

export type IrreversibleDelayListener = (
  ev: IrreversibleDelayEvent,
) => void;

export interface IrreversibleDelayOptions {
  /** Default delay in ms. v2 §3.7 specifies 5 seconds. */
  defaultDelayMs?: number;
  /** Test seam — clock + scheduler. */
  now?: () => number;
  setTimeout?: (cb: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/**
 * Manages the in-flight irreversible-action delay window. One instance
 * per orchestrator process.
 */
export class IrreversibleDelay {
  private readonly defaultDelayMs: number;
  private readonly now: () => number;
  private readonly setTimeoutFn: (cb: () => void, ms: number) => unknown;
  private readonly clearTimeoutFn: (handle: unknown) => void;
  private readonly listeners = new Set<IrreversibleDelayListener>();
  private readonly pending = new Map<
    string,
    {
      handle: unknown;
      resolve: (cancelled: boolean) => void;
      cancelledBy: string | null;
      committedAt: number | null;
    }
  >();

  constructor(opts: IrreversibleDelayOptions = {}) {
    this.defaultDelayMs = opts.defaultDelayMs ?? 5_000;
    this.now = opts.now ?? (() => Date.now());
    this.setTimeoutFn =
      opts.setTimeout ?? ((cb, ms) => globalThis.setTimeout(cb, ms));
    this.clearTimeoutFn =
      opts.clearTimeout ??
      ((h) => globalThis.clearTimeout(h as ReturnType<typeof setTimeout>));
  }

  on(listener: IrreversibleDelayListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Begin a delay window. Returns a promise that resolves to true if the
   * delay elapses without a cancel (proceed to handler), or false if
   * `cancel(tokenId)` was called.
   */
  begin(opts: {
    token: CapabilityToken;
    reason: string;
    delayMs?: number;
  }): Promise<{ cancelled: boolean }> {
    const { token, reason } = opts;
    const delayMs = opts.delayMs ?? this.defaultDelayMs;

    if (this.pending.has(token.tokenId)) {
      throw new Error(
        `IrreversibleDelay: token ${token.tokenId} already has a pending delay window`,
      );
    }

    this.emit({
      kind: 'pending',
      tokenId: token.tokenId,
      capabilityName: token.name,
      scope: token.scope,
      taskId: token.taskId,
      ts: this.now(),
      remainingMs: delayMs,
      reason,
    });

    return new Promise<{ cancelled: boolean }>((resolve) => {
      const handle = this.setTimeoutFn(() => {
        const entry = this.pending.get(token.tokenId);
        if (!entry) return; // cancel raced ahead
        entry.committedAt = this.now();
        this.pending.delete(token.tokenId);
        this.emit({
          kind: 'committed',
          tokenId: token.tokenId,
          capabilityName: token.name,
          scope: token.scope,
          taskId: token.taskId,
          ts: this.now(),
          remainingMs: 0,
          reason,
        });
        resolve({ cancelled: false });
      }, delayMs);

      this.pending.set(token.tokenId, {
        handle,
        resolve: (cancelled) => resolve({ cancelled }),
        cancelledBy: null,
        committedAt: null,
      });
    });
  }

  /**
   * Cancel the in-flight delay window for `tokenId`. Returns true if the
   * window was open + got cancelled, false if no window was open (already
   * committed or never started).
   */
  cancel(opts: {
    tokenId: string;
    by: string;
    capabilityName: CapabilityToken['name'];
    scope: string;
    taskId: string;
    reason: string;
  }): boolean {
    const entry = this.pending.get(opts.tokenId);
    if (!entry) return false;
    this.clearTimeoutFn(entry.handle);
    entry.cancelledBy = opts.by;
    this.pending.delete(opts.tokenId);
    this.emit({
      kind: 'cancelled',
      tokenId: opts.tokenId,
      capabilityName: opts.capabilityName,
      scope: opts.scope,
      taskId: opts.taskId,
      ts: this.now(),
      remainingMs: 0,
      reason: opts.reason,
    });
    entry.resolve(true);
    return true;
  }

  /** Test helper. */
  get pendingCount(): number {
    return this.pending.size;
  }

  private emit(ev: IrreversibleDelayEvent): void {
    for (const l of this.listeners) {
      try {
        l(ev);
      } catch {
        // Listener errors must never break the delay machinery.
      }
    }
  }
}
