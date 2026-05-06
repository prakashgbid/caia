/**
 * Test fakes — in-memory FsAccess + scriptable OllamaClient + adapter
 * directory fixture builders. Any test that touches disk or Ollama should
 * inject these.
 */

import * as path from 'node:path';
import type {
  FsAccess,
  OllamaClient,
  OllamaCreateArgs,
  TrainingMetadataRead
} from '../../src/types.js';

// ──────────────────────────────────────────────────────────────────────────
// In-memory FsAccess
// ──────────────────────────────────────────────────────────────────────────

interface InMemoryFile {
  content: string;
  mtimeMs: number;
}

export interface InMemoryFs extends FsAccess {
  /** Force a file write outside of the FsAccess interface (for fixture
   *  setup). Creates parent dirs. */
  put(p: string, content: string, mtimeMs?: number): void;
  /** Mark a path as a directory (no contents). */
  putDir(p: string): void;
  dump(): Record<string, string>;
}

export function createInMemoryFs(): InMemoryFs {
  const files = new Map<string, InMemoryFile>();
  const dirs = new Set<string>();
  let mtimeCursor = 1_700_000_000_000;

  function ensureParentDirs(p: string): void {
    let cur = path.dirname(p);
    while (cur && cur !== '/' && cur !== '.' && !dirs.has(cur)) {
      dirs.add(cur);
      const parent = path.dirname(cur);
      if (parent === cur) break;
      cur = parent;
    }
  }

  return {
    exists(p: string): boolean {
      return files.has(p) || dirs.has(p);
    },
    readFile(p: string): string {
      const f = files.get(p);
      if (f === undefined) throw new Error(`ENOENT: ${p}`);
      return f.content;
    },
    writeFile(p: string, content: string): void {
      ensureParentDirs(p);
      mtimeCursor += 1;
      files.set(p, { content, mtimeMs: mtimeCursor });
    },
    mkdir(p: string): void {
      dirs.add(p);
      ensureParentDirs(p);
    },
    rename(oldP: string, newP: string): void {
      const f = files.get(oldP);
      if (f === undefined) throw new Error(`ENOENT: ${oldP}`);
      ensureParentDirs(newP);
      mtimeCursor += 1;
      files.set(newP, { content: f.content, mtimeMs: mtimeCursor });
      files.delete(oldP);
    },
    unlink(p: string): void {
      if (!files.has(p)) throw new Error(`ENOENT: ${p}`);
      files.delete(p);
    },
    readDir(p: string): string[] {
      const prefix = p.endsWith('/') ? p : p + '/';
      const direct = new Set<string>();
      for (const filePath of files.keys()) {
        if (filePath.startsWith(prefix)) {
          const rest = filePath.slice(prefix.length);
          const next = rest.split('/')[0]!;
          direct.add(next);
        }
      }
      for (const dirPath of dirs) {
        if (dirPath.startsWith(prefix)) {
          const rest = dirPath.slice(prefix.length);
          const next = rest.split('/')[0]!;
          if (next.length > 0) direct.add(next);
        }
      }
      return Array.from(direct);
    },
    stat(p: string): { mtimeMs: number; size: number; isFile: boolean; isDirectory: boolean } {
      const f = files.get(p);
      if (f !== undefined) {
        return { mtimeMs: f.mtimeMs, size: f.content.length, isFile: true, isDirectory: false };
      }
      if (dirs.has(p)) {
        return { mtimeMs: 0, size: 0, isFile: false, isDirectory: true };
      }
      throw new Error(`ENOENT: ${p}`);
    },
    put(p: string, content: string, mtimeMs?: number): void {
      ensureParentDirs(p);
      mtimeCursor += 1;
      files.set(p, { content, mtimeMs: mtimeMs ?? mtimeCursor });
    },
    putDir(p: string): void {
      dirs.add(p);
      ensureParentDirs(p);
    },
    dump(): Record<string, string> {
      const out: Record<string, string> = {};
      for (const [k, v] of files.entries()) out[k] = v.content;
      return out;
    }
  };
}

// ──────────────────────────────────────────────────────────────────────────
// Fake OllamaClient
// ──────────────────────────────────────────────────────────────────────────

export interface FakeOllamaCall {
  op: 'version' | 'list' | 'create' | 'remove' | 'show';
  args?: Record<string, unknown>;
  result?: unknown;
}

export interface FakeOllamaClient extends OllamaClient {
  /** All calls in order. */
  calls: FakeOllamaCall[];
  /** Models that are currently "loaded". */
  models: Set<string>;
  /** Make the next `create` call throw the given error. */
  failNextCreate?: Error;
  /** Make the next `remove` call throw the given error. */
  failNextRemove?: Error;
  reset(): void;
}

export function createFakeOllamaClient(initial?: { models?: string[] }): FakeOllamaClient {
  const calls: FakeOllamaCall[] = [];
  const models = new Set<string>(initial?.models ?? []);
  const client = {
    calls,
    models,
    async version(): Promise<string> {
      calls.push({ op: 'version', result: '0.23.1' });
      return 'ollama version is 0.23.1';
    },
    async list(): Promise<string[]> {
      const out = Array.from(models);
      calls.push({ op: 'list', result: out });
      return out;
    },
    async create(args: OllamaCreateArgs): Promise<void> {
      if (client.failNextCreate) {
        const err = client.failNextCreate;
        client.failNextCreate = undefined;
        calls.push({ op: 'create', args: { ...args }, result: 'error' });
        throw err;
      }
      models.add(args.modelName);
      calls.push({ op: 'create', args: { ...args }, result: 'ok' });
    },
    async remove(modelName: string): Promise<void> {
      if (client.failNextRemove) {
        const err = client.failNextRemove;
        client.failNextRemove = undefined;
        calls.push({ op: 'remove', args: { modelName }, result: 'error' });
        throw err;
      }
      models.delete(modelName);
      calls.push({ op: 'remove', args: { modelName }, result: 'ok' });
    },
    async show(modelName: string): Promise<string> {
      calls.push({ op: 'show', args: { modelName } });
      return `FROM stub\nADAPTER ./adapters.safetensors\n`;
    },
    failNextCreate: undefined as Error | undefined,
    failNextRemove: undefined as Error | undefined,
    reset(): void {
      calls.length = 0;
      models.clear();
      client.failNextCreate = undefined;
      client.failNextRemove = undefined;
    }
  };
  return client;
}

// ──────────────────────────────────────────────────────────────────────────
// Adapter directory fixtures
// ──────────────────────────────────────────────────────────────────────────

export interface FixtureAdapterOptions {
  adapterPath: string;
  baseModel?: string;
  baseModelOllamaTag?: string;
  configSha256?: string;
  /** When provided, includes an eval-report.json. */
  evalReport?: {
    winRate: number;
    decision: string;
    regressionFlags?: string[];
    name?: string;
  };
  /** Custom fields to merge into training-metadata.json. */
  metadataExtras?: Partial<TrainingMetadataRead>;
}

export function fixtureAdapter(fs: InMemoryFs, opts: FixtureAdapterOptions): {
  metadata: TrainingMetadataRead;
  modelfile: string;
} {
  fs.putDir(opts.adapterPath);
  const metadata: TrainingMetadataRead = {
    version: 1,
    generatedAt: '2026-05-06T00:00:00.000Z',
    baseModel: opts.baseModel ?? 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    baseModelOllamaTag: opts.baseModelOllamaTag ?? 'qwen2.5-coder:7b',
    configSha256: opts.configSha256 ?? 'abc123def456',
    loraConfig: { numLayers: 16, rank: 8 },
    corpusTotals: { samplesUsed: 100 },
    subprocess: { exitCode: 0 },
    warnings: [],
    ...opts.metadataExtras
  };
  fs.put(path.join(opts.adapterPath, 'training-metadata.json'), JSON.stringify(metadata, null, 2));
  const modelfile = `FROM ${metadata.baseModelOllamaTag}\nADAPTER ./adapters.safetensors\nPARAMETER temperature 0.2\nPARAMETER top_p 0.9\n`;
  fs.put(path.join(opts.adapterPath, 'Modelfile'), modelfile);
  fs.put(path.join(opts.adapterPath, 'adapters.safetensors'), 'STUB-SAFETENSORS-CONTENT');
  fs.put(
    path.join(opts.adapterPath, 'adapter_config.json'),
    JSON.stringify({ rank: 8, alpha: 16 }, null, 2)
  );
  if (opts.evalReport) {
    fs.put(
      path.join(opts.adapterPath, 'eval-report.json'),
      JSON.stringify(
        {
          adapters: [
            {
              name: opts.evalReport.name ?? path.basename(opts.adapterPath),
              winRate: opts.evalReport.winRate,
              decision: opts.evalReport.decision,
              regressionFlags: opts.evalReport.regressionFlags ?? []
            }
          ]
        },
        null,
        2
      )
    );
  }
  return { metadata, modelfile };
}

/** A clock that ticks deterministically — every call returns the next ms. */
export function createFakeClock(start = '2026-05-06T12:00:00.000Z'): () => Date {
  let cursor = new Date(start).getTime();
  return () => {
    const d = new Date(cursor);
    cursor += 1;
    return d;
  };
}
