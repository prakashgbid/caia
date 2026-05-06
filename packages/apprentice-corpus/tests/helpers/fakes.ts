/**
 * Test helpers — in-memory fakes for the FsReader / EventBusClient /
 * GithubClient / LangfuseClient / ClaudeDistiller interfaces.
 */

import type {
  ClaudeDistiller,
  DistillInput,
  DistillOutput,
  EventBusClient,
  EventBusRecord,
  FsReader,
  GithubClient,
  GithubPrRecord,
  LangfuseClient,
  LangfuseTraceRecord
} from '../../src/types.js';

/** In-memory FS — handy for normaliser tests that bypass the disk. */
export interface FakeFsEntry {
  path: string;
  content: string;
  mtimeMs: number;
}

export function createFakeFs(entries: FakeFsEntry[]): FsReader {
  const byPath = new Map(entries.map((e) => [e.path, e] as const));
  // Build a directory map: parent → children
  const dirMap = new Map<string, Set<string>>();
  for (const e of entries) {
    const segments = e.path.split('/');
    for (let i = 1; i < segments.length; i += 1) {
      const parent = segments.slice(0, i).join('/');
      const child = segments[i]!;
      if (!dirMap.has(parent)) dirMap.set(parent, new Set());
      dirMap.get(parent)!.add(child);
    }
  }
  return {
    exists(p) {
      return byPath.has(p) || dirMap.has(p);
    },
    readDir(p) {
      const set = dirMap.get(p);
      if (set === undefined) return [];
      return Array.from(set).sort();
    },
    readFile(p) {
      const e = byPath.get(p);
      if (e === undefined) throw new Error(`fake fs miss: ${p}`);
      return e.content;
    },
    stat(p) {
      const e = byPath.get(p);
      if (e === undefined) {
        if (dirMap.has(p)) {
          return { mtimeMs: 0, size: 0, isFile: false };
        }
        throw new Error(`fake fs stat miss: ${p}`);
      }
      return { mtimeMs: e.mtimeMs, size: e.content.length, isFile: true };
    }
  };
}

/** Stub event-bus client. */
export function createFakeEventBus(records: EventBusRecord[]): EventBusClient {
  return {
    async readSince(sinceMs) {
      return records.filter((r) => r.emittedAtMs >= sinceMs);
    }
  };
}

export function createFakeGithub(records: GithubPrRecord[]): GithubClient {
  return {
    async listMergedPrs(sinceMs) {
      return records.filter((r) => r.mergedAtMs >= sinceMs);
    }
  };
}

export function createFakeLangfuse(records: LangfuseTraceRecord[]): LangfuseClient {
  return {
    async listTraces(sinceMs) {
      return records.filter((r) => r.createdAtMs >= sinceMs);
    }
  };
}

/** Configurable fake distiller. */
export function createFakeDistiller(
  fn: (input: DistillInput) => Promise<DistillOutput> | DistillOutput
): ClaudeDistiller {
  return {
    async distill(input) {
      return fn(input);
    }
  };
}
