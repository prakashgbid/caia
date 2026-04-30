/**
 * IrreversibleActionLedger — append-only persistence of every privileged
 * execution. The interface is storage-agnostic; the orchestrator wires up a
 * SQLite-backed implementation using the migration in `migrations/`.
 *
 * For unit tests + the capability-executor's default mode, an in-memory
 * implementation is provided.
 */

import { LedgerEntrySchema, type LedgerEntry } from './types.js';

export interface IrreversibleActionLedger {
  /** Append a new entry. Implementations MUST persist immediately. */
  append(entry: LedgerEntry): Promise<void>;
  /** Read entries by task id, newest first. */
  byTaskId(taskId: string, limit?: number): Promise<readonly LedgerEntry[]>;
  /** Lookup a single entry by its id. */
  byId(id: string): Promise<LedgerEntry | undefined>;
  /** Read recent entries across all tasks. */
  recent(limit: number): Promise<readonly LedgerEntry[]>;
}

/**
 * In-memory ledger. Useful in tests and as a degraded fallback when the
 * primary store is unreachable (with a loud error log emitted by the caller).
 */
export class InMemoryLedger implements IrreversibleActionLedger {
  private entries: LedgerEntry[] = [];

  async append(entry: LedgerEntry): Promise<void> {
    const parsed = LedgerEntrySchema.parse(entry);
    if (this.entries.some((e) => e.id === parsed.id)) {
      throw new Error(
        `InMemoryLedger: duplicate ledger entry id '${parsed.id}'.`,
      );
    }
    this.entries.push(parsed);
  }

  async byTaskId(taskId: string, limit = 100): Promise<readonly LedgerEntry[]> {
    return this.entries
      .filter((e) => e.taskId === taskId)
      .sort((a, b) => b.ts - a.ts)
      .slice(0, limit);
  }

  async byId(id: string): Promise<LedgerEntry | undefined> {
    return this.entries.find((e) => e.id === id);
  }

  async recent(limit: number): Promise<readonly LedgerEntry[]> {
    return [...this.entries].sort((a, b) => b.ts - a.ts).slice(0, limit);
  }

  /** Test-only helper: reset in-memory state. */
  _reset(): void {
    this.entries = [];
  }

  /** Test-only helper: number of entries. */
  get size(): number {
    return this.entries.length;
  }
}
