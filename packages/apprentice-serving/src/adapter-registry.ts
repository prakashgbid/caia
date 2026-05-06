/**
 * AdapterRegistry — owns the persisted JSON registry file. Pure book-keeping;
 * no Ollama subprocess interaction. ApprenticeServing composes this with
 * an OllamaClient to perform end-to-end transitions.
 *
 * Persistence: read-fresh-on-every-mutation; write-to-tmp + atomic rename.
 * Single-writer model — see DESIGN.md §12.
 *
 * Invariants enforced at mutation time:
 *   1. At most one entry has status === 'production'.
 *   2. At most one entry has status === 'canary'.
 *   3. adapterName is unique.
 *   4. archivedAt set iff status === 'archived'.
 *   5. canaryPercent set iff status === 'canary'.
 *   6. rejectionReason set iff status === 'rejected'.
 */

import * as path from 'node:path';
import {
  RegistryCorruptError,
  RegistryInvariantError,
  RegistryStateMismatchError,
  RollbackTargetInvalidError,
  CanaryPercentOutOfRangeError
} from './types.js';
import type {
  AdapterRegistryConfig,
  RegistryEntry,
  RegistryFile,
  RegistryHistoryEntry,
  RegistryStatus,
  ResolvedAdapterRegistryConfig
} from './types.js';
import { resolveAdapterRegistryConfig } from './config.js';

export class AdapterRegistry {
  private readonly cfg: ResolvedAdapterRegistryConfig;

  constructor(config: AdapterRegistryConfig = {}) {
    this.cfg = resolveAdapterRegistryConfig(config);
  }

  /** Read entries fresh from disk. ENOENT → empty registry. */
  list(): RegistryEntry[] {
    return this.read().entries;
  }

  getByPath(adapterPath: string): RegistryEntry | undefined {
    return this.list().find((e) => e.adapterPath === adapterPath);
  }

  getByName(adapterName: string): RegistryEntry | undefined {
    return this.list().find((e) => e.adapterName === adapterName);
  }

  /** At most one. */
  currentProduction(): RegistryEntry | undefined {
    return this.list().find((e) => e.status === 'production');
  }

  /** At most one. */
  currentCanary(): RegistryEntry | undefined {
    return this.list().find((e) => e.status === 'canary');
  }

  /** Idempotent insert/update. If an entry with the same adapterName already
   *  exists, it's replaced. */
  upsert(entry: RegistryEntry): void {
    const file = this.read();
    const idx = file.entries.findIndex((e) => e.adapterName === entry.adapterName);
    if (idx >= 0) {
      file.entries[idx] = entry;
    } else {
      file.entries.push(entry);
    }
    this.assertInvariants(file.entries);
    this.persist(file);
  }

  /**
   * Apply a status transition to the entry identified by `adapterName`.
   * `mutator` runs before invariants are checked + persisted; it MUST set
   * status, plus set/clear archivedAt/canaryPercent/rejectionReason as
   * appropriate. Appends a history entry automatically.
   */
  transition(
    adapterName: string,
    toStatus: RegistryStatus,
    mutator: (entry: RegistryEntry, prev: RegistryStatus) => void,
    note?: string
  ): RegistryEntry {
    const file = this.read();
    const entry = file.entries.find((e) => e.adapterName === adapterName);
    if (!entry) {
      throw new RegistryStateMismatchError(`adapter not registered: ${adapterName}`, {
        adapterName
      });
    }
    const prev: RegistryStatus = entry.status;
    mutator(entry, prev);
    entry.status = toStatus;
    const histEntry: RegistryHistoryEntry = {
      at: this.cfg.clock().toISOString(),
      fromStatus: prev,
      toStatus
    };
    if (note !== undefined) histEntry.note = note;
    entry.history.push(histEntry);
    // Set/clear status-conditional fields.
    if (toStatus !== 'canary') delete entry.canaryPercent;
    if (toStatus !== 'archived') delete entry.archivedAt;
    if (toStatus !== 'rejected') delete entry.rejectionReason;

    this.assertInvariants(file.entries);
    this.persist(file);
    return entry;
  }

  /** Drop an entry from the registry entirely. Used for GC. */
  drop(adapterName: string): RegistryEntry | undefined {
    const file = this.read();
    const idx = file.entries.findIndex((e) => e.adapterName === adapterName);
    if (idx < 0) return undefined;
    const [removed] = file.entries.splice(idx, 1);
    this.persist(file);
    return removed;
  }

  // ────────────────────────────────────────────────────────────────────
  // Internal — read / persist / invariants
  // ────────────────────────────────────────────────────────────────────

  read(): RegistryFile {
    const fs = this.cfg.fs;
    const p = this.cfg.registryPath;
    if (!fs.exists(p)) {
      return {
        version: 1,
        generatedAt: this.cfg.clock().toISOString(),
        entries: []
      };
    }
    let raw: string;
    try {
      raw = fs.readFile(p);
    } catch (e) {
      throw new RegistryCorruptError(`failed to read registry: ${(e as Error).message}`, {
        path: p
      });
    }
    if (raw.trim().length === 0) {
      return {
        version: 1,
        generatedAt: this.cfg.clock().toISOString(),
        entries: []
      };
    }
    try {
      const parsed = JSON.parse(raw) as RegistryFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.entries)) {
        throw new RegistryCorruptError(`unexpected registry shape (version=${parsed.version})`, {
          path: p
        });
      }
      return parsed;
    } catch (e) {
      throw new RegistryCorruptError(`registry JSON parse failed: ${(e as Error).message}`, {
        path: p
      });
    }
  }

  private persist(file: RegistryFile): void {
    file.generatedAt = this.cfg.clock().toISOString();
    const fs = this.cfg.fs;
    const p = this.cfg.registryPath;
    const dir = path.dirname(p);
    if (!fs.exists(dir)) fs.mkdir(dir);
    // Best-effort backup.
    if (fs.exists(p)) {
      try {
        const prev = fs.readFile(p);
        fs.writeFile(p + '.bak', prev);
      } catch {
        /* backup failure is non-fatal */
      }
    }
    const tmp = p + '.tmp';
    fs.writeFile(tmp, JSON.stringify(file, null, 2) + '\n');
    fs.rename(tmp, p);
  }

  /** Throws RegistryInvariantError on first violation. */
  assertInvariants(entries: RegistryEntry[]): void {
    const productionCount = entries.filter((e) => e.status === 'production').length;
    if (productionCount > 1) {
      throw new RegistryInvariantError(
        `invariant violated: more than one production entry (${productionCount})`,
        { production: entries.filter((e) => e.status === 'production').map((e) => e.adapterName) }
      );
    }
    const canaryCount = entries.filter((e) => e.status === 'canary').length;
    if (canaryCount > 1) {
      throw new RegistryInvariantError(
        `invariant violated: more than one canary entry (${canaryCount})`,
        { canary: entries.filter((e) => e.status === 'canary').map((e) => e.adapterName) }
      );
    }
    const names = new Set<string>();
    for (const e of entries) {
      if (names.has(e.adapterName)) {
        throw new RegistryInvariantError(`invariant violated: duplicate adapterName: ${e.adapterName}`, {
          adapterName: e.adapterName
        });
      }
      names.add(e.adapterName);
      if (e.status === 'archived' && !e.archivedAt) {
        throw new RegistryInvariantError(
          `invariant violated: archived entry without archivedAt: ${e.adapterName}`,
          { adapterName: e.adapterName }
        );
      }
      if (e.archivedAt !== undefined && e.status !== 'archived') {
        throw new RegistryInvariantError(
          `invariant violated: archivedAt set on non-archived entry: ${e.adapterName}`,
          { adapterName: e.adapterName, status: e.status }
        );
      }
      if (e.status === 'canary' && (e.canaryPercent === undefined || e.canaryPercent === null)) {
        throw new RegistryInvariantError(
          `invariant violated: canary without canaryPercent: ${e.adapterName}`,
          { adapterName: e.adapterName }
        );
      }
      if (e.canaryPercent !== undefined && e.status !== 'canary') {
        throw new RegistryInvariantError(
          `invariant violated: canaryPercent set on non-canary entry: ${e.adapterName}`,
          { adapterName: e.adapterName, status: e.status }
        );
      }
      if (e.status === 'rejected' && (e.rejectionReason === undefined || e.rejectionReason === '')) {
        throw new RegistryInvariantError(
          `invariant violated: rejected without rejectionReason: ${e.adapterName}`,
          { adapterName: e.adapterName }
        );
      }
      if (e.rejectionReason !== undefined && e.status !== 'rejected') {
        throw new RegistryInvariantError(
          `invariant violated: rejectionReason set on non-rejected entry: ${e.adapterName}`,
          { adapterName: e.adapterName, status: e.status }
        );
      }
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Pre-mutation guards used by ApprenticeServing
  // ────────────────────────────────────────────────────────────────────

  /** Throws if (entry, target) is not a valid transition. */
  static assertValidTransition(prev: RegistryStatus, target: RegistryStatus): void {
    const validFrom: Record<RegistryStatus, RegistryStatus[]> = {
      registered: ['shadow', 'canary', 'rejected', 'archived'],
      shadow: ['canary', 'rejected', 'archived'],
      canary: ['production', 'rejected', 'archived'],
      production: ['archived'],
      archived: ['canary', 'production', 'rejected'],
      rejected: []
    };
    const allowed = validFrom[prev];
    if (!allowed.includes(target)) {
      throw new RegistryStateMismatchError(
        `invalid transition: ${prev} → ${target}`,
        { from: prev, to: target }
      );
    }
  }

  /** Validates rollback semantics: target must be archived. */
  static assertRollbackTarget(entry: RegistryEntry): void {
    if (entry.status !== 'archived') {
      throw new RollbackTargetInvalidError(
        `rollback target must be in 'archived' state; was '${entry.status}'`,
        { adapterName: entry.adapterName, status: entry.status }
      );
    }
  }

  /** Validates canary percent. */
  static assertCanaryPercent(percent: number): void {
    if (!Number.isFinite(percent) || percent < 0 || percent > 100) {
      throw new CanaryPercentOutOfRangeError(`percent must be in [0, 100]; got ${percent}`, {
        percent
      });
    }
  }
}
