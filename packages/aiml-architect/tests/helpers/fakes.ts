/**
 * Fake DI seams for unit tests.
 */

import type {
  AdapterRegistryEntry,
  AdapterRegistryReader,
  CuratorFinding,
  CuratorReader,
  FsReader,
  MentorEventRecord,
  MentorReader
} from '../../src/types.js';

export interface InMemoryFsState {
  files?: Record<string, { content: string; mtimeMs?: number }>;
  dirs?: Record<string, string[]>;
}

export function buildFakeFs(state: InMemoryFsState): FsReader {
  const files = state.files ?? {};
  const dirs = state.dirs ?? {};
  return {
    exists(path: string): boolean {
      return Object.prototype.hasOwnProperty.call(files, path) ||
        Object.prototype.hasOwnProperty.call(dirs, path);
    },
    readDir(path: string): string[] {
      return dirs[path] ?? [];
    },
    readFile(path: string): string {
      const entry = files[path];
      if (entry === undefined) throw new Error(`fake-fs: missing ${path}`);
      return entry.content;
    },
    stat(path: string): { mtimeMs: number; size: number; isFile: boolean } {
      const entry = files[path];
      if (entry !== undefined) {
        return {
          mtimeMs: entry.mtimeMs ?? 0,
          size: entry.content.length,
          isFile: true
        };
      }
      if (Object.prototype.hasOwnProperty.call(dirs, path)) {
        return { mtimeMs: 0, size: 0, isFile: false };
      }
      throw new Error(`fake-fs: missing ${path}`);
    }
  };
}

export function buildFakeMentor(
  events: MentorEventRecord[]
): MentorReader {
  return {
    readSince(sinceMs: number, limit = 500): MentorEventRecord[] {
      return events
        .filter((e) => e.emittedAtMs >= sinceMs)
        .slice(0, limit);
    }
  };
}

export function buildFakeCurator(
  findings: CuratorFinding[]
): CuratorReader {
  return {
    readRecent(limit = 100): CuratorFinding[] {
      return findings.slice(0, limit);
    }
  };
}

export function buildFakeAdapterRegistry(
  entries: AdapterRegistryEntry[]
): AdapterRegistryReader {
  return {
    list(): AdapterRegistryEntry[] {
      return entries;
    }
  };
}

export function fixedClock(iso: string): () => Date {
  const d = new Date(iso);
  return (): Date => d;
}
