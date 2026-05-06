/**
 * StateStore — owns the persisted retrainer-state.json file. Read-fresh-
 * on-every-mutation; write-to-tmp + atomic rename. Pre-existing .bak
 * preservation. Same pattern as apprentice-serving's AdapterRegistry.
 */

import * as path from 'node:path';
import { StateCorruptError } from './types.js';
import type {
  FsAccess,
  RetrainerOutcome,
  RetrainerStateFile,
  RetrainerHistoryEntry,
  LastTrainRecord,
  LastErrorRecord
} from './types.js';

export interface StateStoreConfig {
  runStatePath: string;
  fs: FsAccess;
  clock: () => Date;
  /** Default 52 (1 year of weekly history). */
  historyMax?: number;
}

export class StateStore {
  private readonly cfg: Required<StateStoreConfig>;

  constructor(cfg: StateStoreConfig) {
    this.cfg = { historyMax: 52, ...cfg };
  }

  read(): RetrainerStateFile {
    const fs = this.cfg.fs;
    const p = this.cfg.runStatePath;
    if (!fs.exists(p)) return this.empty();
    let raw: string;
    try {
      raw = fs.readFile(p);
    } catch (e) {
      throw new StateCorruptError(`failed to read state: ${(e as Error).message}`, { path: p });
    }
    if (raw.trim().length === 0) return this.empty();
    try {
      const parsed = JSON.parse(raw) as RetrainerStateFile;
      if (parsed.version !== 1) {
        throw new StateCorruptError(`unexpected state version: ${parsed.version}`, { path: p });
      }
      return parsed;
    } catch (e) {
      if (e instanceof StateCorruptError) throw e;
      throw new StateCorruptError(`state JSON parse failed: ${(e as Error).message}`, { path: p });
    }
  }

  /** Write atomically: tmp + rename. Pre-existing version backed up to .bak. */
  write(state: RetrainerStateFile): void {
    state.generatedAt = this.cfg.clock().toISOString();
    if (state.history.length > this.cfg.historyMax) {
      state.history = state.history.slice(-this.cfg.historyMax);
    }
    const fs = this.cfg.fs;
    const p = this.cfg.runStatePath;
    const dir = path.dirname(p);
    if (!fs.exists(dir)) fs.mkdir(dir);
    if (fs.exists(p)) {
      try {
        const prev = fs.readFile(p);
        fs.writeFile(p + '.bak', prev);
      } catch {
        /* non-fatal */
      }
    }
    const tmp = p + '.tmp';
    fs.writeFile(tmp, JSON.stringify(state, null, 2) + '\n');
    fs.rename(tmp, p);
  }

  /** Append a history entry + persist. Returns the updated state. */
  recordOutcome(outcome: RetrainerOutcome, extras: { adapterName?: string; note?: string } = {}): RetrainerStateFile {
    const state = this.read();
    const entry: RetrainerHistoryEntry = {
      at: this.cfg.clock().toISOString(),
      outcome
    };
    if (extras.adapterName !== undefined) entry.adapterName = extras.adapterName;
    if (extras.note !== undefined) entry.note = extras.note;
    state.history.push(entry);
    this.write(state);
    return state;
  }

  recordSuccessfulTrain(record: LastTrainRecord): RetrainerStateFile {
    const state = this.read();
    state.lastSuccessfulTrain = record;
    this.write(state);
    return state;
  }

  recordCanaryPromotion(at: string): void {
    const state = this.read();
    state.lastCanaryPromotedAt = at;
    this.write(state);
  }

  recordProductionPromotion(at: string): void {
    const state = this.read();
    state.lastProductionPromotedAt = at;
    this.write(state);
  }

  recordError(err: LastErrorRecord): void {
    const state = this.read();
    state.lastError = err;
    this.write(state);
  }

  clearError(): void {
    const state = this.read();
    if (state.lastError !== null) {
      state.lastError = null;
      this.write(state);
    }
  }

  private empty(): RetrainerStateFile {
    return {
      version: 1,
      generatedAt: this.cfg.clock().toISOString(),
      lastSuccessfulTrain: null,
      lastCanaryPromotedAt: null,
      lastProductionPromotedAt: null,
      lastError: null,
      history: []
    };
  }
}
