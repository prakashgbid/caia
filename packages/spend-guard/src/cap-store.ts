/**
 * Cap-store — pluggable storage for SpendCap rows. The orchestrator wires
 * up a SQLite-backed implementation; the in-memory variant in this file
 * is what unit tests + a degraded fallback uses.
 */

import { SpendCapSchema, type SpendCap, type SpendCapScope } from './types.js';

export interface CapStore {
  /**
   * Atomically read the cap row, or initialise a fresh one when none
   * exists. Implementations MUST guarantee read-modify-write atomicity.
   */
  getOrCreate(opts: {
    scope: SpendCapScope;
    resourceId: string;
    /** Used to seed `limitUsd` if the row didn't exist. */
    defaultLimitUsd: number;
    /** Used to seed `periodSec`. */
    defaultPeriodSec: number;
    nowMs: number;
  }): Promise<SpendCap>;
  /** Persist an updated cap row. */
  put(cap: SpendCap): Promise<void>;
  /** Snapshot of all caps (dashboard query). */
  list(): Promise<readonly SpendCap[]>;
}

/** In-memory CapStore. Used by unit tests + as a degraded fallback. */
export class InMemoryCapStore implements CapStore {
  private store = new Map<string, SpendCap>();

  private key(scope: SpendCapScope, resourceId: string): string {
    return `${scope}|${resourceId}`;
  }

  async getOrCreate(opts: {
    scope: SpendCapScope;
    resourceId: string;
    defaultLimitUsd: number;
    defaultPeriodSec: number;
    nowMs: number;
  }): Promise<SpendCap> {
    const k = this.key(opts.scope, opts.resourceId);
    const existing = this.store.get(k);
    if (existing) return existing;
    const fresh: SpendCap = SpendCapSchema.parse({
      scope: opts.scope,
      resourceId: opts.resourceId,
      periodSec: opts.defaultPeriodSec,
      limitUsd: opts.defaultLimitUsd,
      currentUsd: 0,
      lastResetMsEpoch: opts.nowMs,
      lockedUntilMsEpoch: null,
    });
    this.store.set(k, fresh);
    return fresh;
  }

  async put(cap: SpendCap): Promise<void> {
    const parsed = SpendCapSchema.parse(cap);
    this.store.set(this.key(parsed.scope, parsed.resourceId), parsed);
  }

  async list(): Promise<readonly SpendCap[]> {
    return Array.from(this.store.values());
  }

  /** Test helper. */
  _reset(): void {
    this.store.clear();
  }
}
