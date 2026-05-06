/**
 * Test-only fakes for the injected `FsAccess` and `SubprocessRunner`
 * interfaces. The fake fs is in-memory; the fake subprocess returns a
 * scripted result + records the invocation for assertion.
 */

import type {
  FsAccess,
  SubprocessArgs,
  SubprocessResult,
  SubprocessRunner
} from '../../src/types.js';

export interface InMemoryFs extends FsAccess {
  readonly files: Map<string, string>;
  readonly dirs: Set<string>;
  readonly writes: Array<{ path: string; content: string }>;
}

export function createInMemoryFs(seed: Record<string, string> = {}): InMemoryFs {
  const files = new Map<string, string>(Object.entries(seed));
  const dirs = new Set<string>();
  const writes: Array<{ path: string; content: string }> = [];

  // Seed dirs: any path ending in '/' or that has children gets a dir entry.
  for (const p of files.keys()) {
    let parent = p.replace(/\/[^/]*$/, '');
    while (parent.length > 0 && !dirs.has(parent)) {
      dirs.add(parent);
      const next = parent.replace(/\/[^/]*$/, '');
      if (next === parent) break;
      parent = next;
    }
  }

  return {
    files,
    dirs,
    writes,
    exists(p: string): boolean {
      return files.has(p) || dirs.has(p);
    },
    readFile(p: string): string {
      const c = files.get(p);
      if (c === undefined) throw new Error(`fake fs: file not found: ${p}`);
      return c;
    },
    writeFile(p: string, content: string): void {
      files.set(p, content);
      writes.push({ path: p, content });
      let parent = p.replace(/\/[^/]*$/, '');
      while (parent.length > 0 && !dirs.has(parent)) {
        dirs.add(parent);
        const next = parent.replace(/\/[^/]*$/, '');
        if (next === parent) break;
        parent = next;
      }
    },
    mkdir(p: string): void {
      dirs.add(p);
    },
    readDir(p: string): string[] {
      if (!dirs.has(p)) throw new Error(`fake fs: dir not found: ${p}`);
      const prefix = p.endsWith('/') ? p : p + '/';
      const children = new Set<string>();
      for (const f of files.keys()) {
        if (f.startsWith(prefix)) {
          const rest = f.slice(prefix.length).split('/')[0];
          if (rest !== undefined && rest.length > 0) children.add(rest);
        }
      }
      for (const d of dirs) {
        if (d.startsWith(prefix)) {
          const rest = d.slice(prefix.length).split('/')[0];
          if (rest !== undefined && rest.length > 0) children.add(rest);
        }
      }
      return [...children].sort();
    },
    stat(p: string): { mtimeMs: number; size: number; isFile: boolean; isDirectory: boolean } {
      if (files.has(p)) {
        return { mtimeMs: 1_700_000_000_000, size: files.get(p)!.length, isFile: true, isDirectory: false };
      }
      if (dirs.has(p)) {
        return { mtimeMs: 1_700_000_000_000, size: 0, isFile: false, isDirectory: true };
      }
      throw new Error(`fake fs: stat target not found: ${p}`);
    }
  };
}

/**
 * Configurable fake subprocess runner. By default succeeds (exit 0)
 * with empty log. Each invocation also `produces` files in the
 * underlying fs (use this to simulate mlx-lm writing
 * `adapters.safetensors` + `adapter_config.json`).
 */
export interface FakeSubprocessOptions {
  exitCode?: number;
  signal?: string | null;
  elapsedMs?: number;
  logTail?: string;
  timedOut?: boolean;
  /** After-the-fact filesystem writes — caller passes the test's fs. */
  produces?: (fs: FsAccess, args: SubprocessArgs) => void;
}

export interface FakeSubprocessRunner extends SubprocessRunner {
  readonly invocations: SubprocessArgs[];
}

export function createFakeSubprocess(
  fs: FsAccess,
  scripted: FakeSubprocessOptions | ((args: SubprocessArgs) => FakeSubprocessOptions) = {}
): FakeSubprocessRunner {
  const invocations: SubprocessArgs[] = [];
  return {
    invocations,
    async run(args: SubprocessArgs): Promise<SubprocessResult> {
      invocations.push(args);
      const opts = typeof scripted === 'function' ? scripted(args) : scripted;
      if (opts.produces) opts.produces(fs, args);
      return {
        exitCode: opts.exitCode ?? 0,
        signal: opts.signal ?? null,
        elapsedMs: opts.elapsedMs ?? 100,
        logTail: opts.logTail ?? '',
        timedOut: opts.timedOut ?? false
      };
    }
  };
}

/**
 * Build a minimal Phase 0-shape sample.
 */
export function fixtureSample(id: string, instruction = 'Q?', response = 'A.'): {
  id: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
  meta: Record<string, unknown>;
} {
  return {
    id,
    messages: [
      { role: 'system', content: 'You are CAIA.' },
      { role: 'user', content: instruction },
      { role: 'assistant', content: response }
    ],
    meta: { source: 'memory', kind: 'directive' }
  };
}

/**
 * Build a minimal Phase 0-shape manifest. `holdout` is optional —
 * pass an array to test the holdout path; omit to test the id-hash
 * fallback.
 */
export function fixtureManifest(opts: {
  outputDir: string;
  totalSamples: number;
  holdout?: string[];
}): {
  version: number;
  generatedAt: string;
  outputDir: string;
  totals: { final: number };
  holdout?: string[];
  configSha256: string;
} {
  const result: {
    version: number;
    generatedAt: string;
    outputDir: string;
    totals: { final: number };
    holdout?: string[];
    configSha256: string;
  } = {
    version: 1,
    generatedAt: '2026-05-06T12:00:00.000Z',
    outputDir: opts.outputDir,
    totals: { final: opts.totalSamples },
    configSha256: 'fixturesha'
  };
  if (opts.holdout) result.holdout = opts.holdout;
  return result;
}
