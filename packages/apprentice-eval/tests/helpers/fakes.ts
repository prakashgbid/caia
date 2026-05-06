/**
 * Test fakes — in-memory implementations of the DI seams.
 */

import type {
  ClaudeJudge,
  FsReader,
  FsWriter,
  GenerateRequest,
  GenerateResult,
  MlxFallback,
  OllamaClient
} from '../../src/types.js';

// ─── In-memory FS ────────────────────────────────────────────────────────

export class InMemoryFs implements FsReader, FsWriter {
  files = new Map<string, string>();
  dirs = new Set<string>();

  async readFile(path: string): Promise<string> {
    const content = this.files.get(path);
    if (content === undefined) throw new Error(`fake fs: not found: ${path}`);
    return content;
  }
  async readDir(path: string): Promise<ReadonlyArray<string>> {
    const norm = path.replace(/\/+$/, '');
    const out: string[] = [];
    for (const k of this.files.keys()) {
      const dir = k.substring(0, k.lastIndexOf('/'));
      if (dir === norm) out.push(k.substring(norm.length + 1));
    }
    return out.sort();
  }
  async exists(path: string): Promise<boolean> {
    return this.files.has(path) || this.dirs.has(path) || this.dirs.has(path.replace(/\/+$/, ''));
  }
  async stat(path: string): Promise<{ readonly mtimeMs: number; readonly size: number }> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`fake fs: not found: ${path}`);
    return { mtimeMs: 0, size: c.length };
  }
  async writeFile(path: string, data: string): Promise<void> {
    this.files.set(path, data);
    const dir = path.substring(0, path.lastIndexOf('/'));
    if (dir) this.dirs.add(dir);
  }
  async mkdir(path: string): Promise<void> {
    this.dirs.add(path);
  }
}

// ─── Fake providers ──────────────────────────────────────────────────────

export interface FakeOllamaOpts {
  /** Map prompt → output. Default: identity ("ECHO: <prompt>"). */
  readonly outputs?: Map<string, string>;
  /** Map (model+adapter) → output for that model. */
  readonly perAdapterOutputs?: Map<string, Map<string, string>>;
  readonly supportsAdapters?: boolean;
  readonly reachable?: boolean;
}

export function createFakeOllama(opts: FakeOllamaOpts = {}): OllamaClient {
  const outputs = opts.outputs ?? new Map<string, string>();
  const perAdapter = opts.perAdapterOutputs ?? new Map<string, Map<string, string>>();
  const supportsAdapters = opts.supportsAdapters ?? true;
  const reachable = opts.reachable ?? true;
  return {
    async ping() {
      if (!reachable) throw new Error('fake ollama: unreachable');
    },
    async supportsAdapters() {
      return supportsAdapters;
    },
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const adapterMap = req.adapter ? perAdapter.get(req.adapter) : undefined;
      const output = adapterMap?.get(req.prompt) ?? outputs.get(req.prompt) ?? `ECHO: ${req.prompt}`;
      return {
        output,
        elapsedMs: 1,
        model: req.model,
        ...(req.adapter !== undefined ? { adapter: req.adapter } : {}),
        provider: 'fake',
        ...(req.seed !== undefined ? { seed: req.seed } : {})
      };
    }
  };
}

export function createUnreachableOllama(): OllamaClient {
  return createFakeOllama({ reachable: false });
}

export function createFakeMlx(opts: { available?: boolean; output?: string } = {}): MlxFallback {
  const available = opts.available ?? false;
  const output = opts.output ?? 'mlx-output';
  return {
    async available() {
      return available;
    },
    async generate(req: GenerateRequest): Promise<GenerateResult> {
      return {
        output,
        elapsedMs: 2,
        model: req.model,
        ...(req.adapter !== undefined ? { adapter: req.adapter } : {}),
        provider: 'mlx',
        ...(req.seed !== undefined ? { seed: req.seed } : {})
      };
    }
  };
}

export function createFakeJudge(opts: { available?: boolean; preference?: 'A' | 'B' | 'tie' } = {}): ClaudeJudge {
  const available = opts.available ?? true;
  const preference = opts.preference ?? 'A';
  return {
    async available() {
      return available;
    },
    async judge() {
      return { preference, rationale: `fake-judge prefers ${preference}` };
    }
  };
}
