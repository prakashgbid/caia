/**
 * Test fakes — in-memory FsAccess + scriptable corpus/trainer/eval/serving
 * for end-to-end retrainer testing.
 */

import * as path from 'node:path';
import type {
  CorpusAggregator,
  CorpusAggregateResult,
  EvalAdapterReport,
  EvalHarness,
  EvalReport,
  EvalRequest,
  FsAccess,
  RegistryEntry,
  Trainer,
  TrainerRequest,
  TrainerResult
} from '../../src/types.js';
import type { ApprenticeServing } from '@chiefaia/apprentice-serving';

// ──────────────────────────────────────────────────────────────────────────
// In-memory FsAccess (mirrors apprentice-serving's fake)
// ──────────────────────────────────────────────────────────────────────────

interface InMemoryFile {
  content: string;
  mtimeMs: number;
}

export interface InMemoryFs extends FsAccess {
  put(p: string, content: string): void;
  putDir(p: string): void;
  dump(): Record<string, string>;
  has(p: string): boolean;
}

export function createInMemoryFs(): InMemoryFs {
  const files = new Map<string, InMemoryFile>();
  const dirs = new Set<string>();
  let mtimeCursor = 1_700_000_000_000;
  function ensureParents(p: string): void {
    let cur = path.dirname(p);
    while (cur && cur !== '/' && cur !== '.' && !dirs.has(cur)) {
      dirs.add(cur);
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }
  return {
    exists: (p) => files.has(p) || dirs.has(p),
    readFile: (p) => {
      const f = files.get(p);
      if (!f) throw new Error('ENOENT: ' + p);
      return f.content;
    },
    writeFile: (p, c) => {
      ensureParents(p);
      mtimeCursor += 1;
      files.set(p, { content: c, mtimeMs: mtimeCursor });
    },
    mkdir: (p) => {
      dirs.add(p);
      ensureParents(p);
    },
    rename: (o, n) => {
      const f = files.get(o);
      if (!f) throw new Error('ENOENT: ' + o);
      ensureParents(n);
      mtimeCursor += 1;
      files.set(n, { content: f.content, mtimeMs: mtimeCursor });
      files.delete(o);
    },
    unlink: (p) => {
      if (!files.has(p)) throw new Error('ENOENT: ' + p);
      files.delete(p);
    },
    appendFile: (p, c) => {
      const existing = files.get(p);
      const content = (existing?.content ?? '') + c;
      mtimeCursor += 1;
      ensureParents(p);
      files.set(p, { content, mtimeMs: mtimeCursor });
    },
    put: (p, c) => {
      ensureParents(p);
      mtimeCursor += 1;
      files.set(p, { content: c, mtimeMs: mtimeCursor });
    },
    putDir: (p) => {
      dirs.add(p);
      ensureParents(p);
    },
    dump: () => {
      const out: Record<string, string> = {};
      for (const [k, v] of files.entries()) out[k] = v.content;
      return out;
    },
    has: (p) => files.has(p)
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Fake corpus aggregator
// ──────────────────────────────────────────────────────────────────────────

export interface FakeCorpusAggregator extends CorpusAggregator {
  scripted: CorpusAggregateResult[];
  calls: number;
}

export function createFakeCorpusAggregator(scripted: CorpusAggregateResult[]): FakeCorpusAggregator {
  let calls = 0;
  const list = [...scripted];
  return {
    scripted: list,
    get calls() {
      return calls;
    },
    async aggregate() {
      calls += 1;
      const next = list.shift();
      if (!next) throw new Error('FakeCorpusAggregator: scripted exhausted');
      return next;
    }
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Fake trainer
// ──────────────────────────────────────────────────────────────────────────

export interface FakeTrainer extends Trainer {
  scripted: TrainerResult[];
  invocations: TrainerRequest[];
}

export function createFakeTrainer(scripted: TrainerResult[]): FakeTrainer {
  const invocations: TrainerRequest[] = [];
  const list = [...scripted];
  return {
    scripted: list,
    invocations,
    async train(req: TrainerRequest) {
      invocations.push(req);
      const next = list.shift();
      if (!next) throw new Error('FakeTrainer: scripted exhausted');
      return next;
    }
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Fake eval harness
// ──────────────────────────────────────────────────────────────────────────

export interface FakeEvalHarness extends EvalHarness {
  scripted: EvalAdapterReport[];
  invocations: EvalRequest[];
}

export function createFakeEvalHarness(scripted: EvalAdapterReport[]): FakeEvalHarness {
  const invocations: EvalRequest[] = [];
  const list = [...scripted];
  return {
    scripted: list,
    invocations,
    async evaluate(req: EvalRequest): Promise<EvalReport> {
      invocations.push(req);
      const next = list.shift();
      if (!next) throw new Error('FakeEvalHarness: scripted exhausted');
      return { adapters: [next], outputDir: '/fake-eval' };
    }
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Fake ApprenticeServing — implements the subset the retrainer uses
// ──────────────────────────────────────────────────────────────────────────

export interface FakeServingState {
  registered: Map<string, RegistryEntry>;
  /** invocation log */
  calls: Array<
    | { op: 'register'; adapterPath: string }
    | { op: 'promoteToCanary'; adapterPath: string; percent: number }
    | { op: 'promoteToProduction'; adapterPath: string }
    | { op: 'reject'; adapterPath: string; reason: string }
  >;
}

export function createFakeServing(
  initial: FakeServingState = { registered: new Map(), calls: [] },
  clock: () => Date = () => new Date()
): ApprenticeServing & {
  fakeState: FakeServingState;
} {
  const state = initial;
  function nowIso(): string {
    return clock().toISOString();
  }
  function bumpHistory(e: RegistryEntry, toStatus: RegistryEntry['status'], note?: string): void {
    e.history.push({
      at: nowIso(),
      fromStatus: e.status,
      toStatus,
      ...(note !== undefined ? { note } : {})
    });
    e.status = toStatus;
  }
  function makeEntry(adapterPath: string): RegistryEntry {
    const adapterName = path.basename(adapterPath);
    return {
      adapterName,
      adapterPath,
      metadataSha256: 'a'.repeat(64),
      configSha256: 'cfg-' + adapterName,
      baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
      baseModelOllamaTag: 'qwen2.5-coder:7b',
      status: 'registered',
      history: [{ at: nowIso(), fromStatus: null, toStatus: 'registered' }],
      registeredAt: nowIso()
    };
  }
  const fake = {
    fakeState: state,
    async register(adapterPath: string): Promise<RegistryEntry> {
      state.calls.push({ op: 'register', adapterPath });
      const adapterName = path.basename(adapterPath);
      let e = state.registered.get(adapterName);
      if (e === undefined) {
        e = makeEntry(adapterPath);
        state.registered.set(adapterName, e);
      }
      return e;
    },
    async promoteToCanary(adapterPath: string, percent: number): Promise<RegistryEntry> {
      state.calls.push({ op: 'promoteToCanary', adapterPath, percent });
      const adapterName = path.basename(adapterPath);
      // Archive any existing canary first.
      for (const other of state.registered.values()) {
        if (other.status === 'canary' && other.adapterName !== adapterName) {
          bumpHistory(other, 'archived', 'replaced by newer canary');
          other.archivedAt = nowIso();
          delete other.canaryPercent;
          delete other.ollamaModelName;
        }
      }
      let e = state.registered.get(adapterName);
      if (e === undefined) {
        e = makeEntry(adapterPath);
        state.registered.set(adapterName, e);
      }
      bumpHistory(e, 'canary');
      e.canaryPercent = percent;
      e.ollamaModelName = `qwen2-5-coder-7b-canary-${e.metadataSha256.slice(0, 7)}`;
      e.promotedAt = nowIso();
      return e;
    },
    async promoteToProduction(adapterPath: string): Promise<RegistryEntry> {
      state.calls.push({ op: 'promoteToProduction', adapterPath });
      const adapterName = path.basename(adapterPath);
      // Archive prior production.
      for (const other of state.registered.values()) {
        if (other.status === 'production' && other.adapterName !== adapterName) {
          bumpHistory(other, 'archived', 'replaced by newer production');
          other.archivedAt = nowIso();
          delete other.ollamaModelName;
        }
      }
      let e = state.registered.get(adapterName);
      if (e === undefined) {
        e = makeEntry(adapterPath);
        state.registered.set(adapterName, e);
      }
      bumpHistory(e, 'production');
      delete e.canaryPercent;
      e.ollamaModelName = 'qwen2-5-coder-7b-production';
      e.promotedAt = nowIso();
      return e;
    },
    async rollback(toAdapterPath: string): Promise<RegistryEntry> {
      const adapterName = path.basename(toAdapterPath);
      const e = state.registered.get(adapterName);
      if (!e) throw new Error(`fake serving: not registered: ${adapterName}`);
      bumpHistory(e, 'production');
      e.ollamaModelName = 'qwen2-5-coder-7b-production';
      delete e.archivedAt;
      return e;
    },
    async reject(adapterPath: string, reason: string): Promise<RegistryEntry> {
      state.calls.push({ op: 'reject', adapterPath, reason });
      const adapterName = path.basename(adapterPath);
      let e = state.registered.get(adapterName);
      if (e === undefined) {
        e = makeEntry(adapterPath);
        state.registered.set(adapterName, e);
      }
      bumpHistory(e, 'rejected');
      e.rejectionReason = reason;
      delete e.canaryPercent;
      delete e.ollamaModelName;
      return e;
    },
    list(): RegistryEntry[] {
      return Array.from(state.registered.values());
    },
    currentProduction(): RegistryEntry | undefined {
      return Array.from(state.registered.values()).find((e) => e.status === 'production');
    },
    currentCanary(): RegistryEntry | undefined {
      return Array.from(state.registered.values()).find((e) => e.status === 'canary');
    }
  };
  return fake as unknown as ApprenticeServing & { fakeState: FakeServingState };
}

/**
 * Build a corpus-manifest JSON body that PASSES the APP.2 quality gate
 * (avg >= 0.55, count >= 300). Override `totals.final` / `qualityHistogram`
 * to exercise the failing branch.
 */
export function passingManifest(
  overrides: { totals?: { final?: number }; qualityHistogram?: Record<string, number> } = {}
): string {
  const totalsFinal = overrides.totals?.final ?? 600;
  const histogram = overrides.qualityHistogram ?? {
    '0.0-0.2': 0,
    '0.2-0.4': 0,
    '0.4-0.6': 200,
    '0.6-0.8': 300,
    '0.8-1.0': 100
  };
  return JSON.stringify({
    version: 1,
    generatedAt: '2026-05-13T00:00:00.000Z',
    outputDir: '/c/2026-05-13',
    elapsedMs: 1234,
    totals: {
      rawArtifacts: totalsFinal,
      afterDedup: totalsFinal,
      afterPII: totalsFinal,
      afterQuality: totalsFinal,
      distilled: 0,
      dropped: 0,
      final: totalsFinal
    },
    perSource: {},
    redactedSpansHistogram: {},
    qualityHistogram: histogram,
    configSha256: 'cfg-sha',
    warnings: [],
    holdout: []
  });
}

export function createFakeClock(start = '2026-05-06T02:00:00.000Z'): {
  clock: () => Date;
  advance(ms: number): void;
  setNow(iso: string): void;
} {
  let cursor = new Date(start).getTime();
  return {
    clock: () => new Date(cursor),
    advance(ms: number) {
      cursor += ms;
    },
    setNow(iso: string) {
      cursor = new Date(iso).getTime();
    }
  };
}
