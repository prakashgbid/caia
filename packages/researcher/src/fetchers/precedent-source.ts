/**
 * PrecedentSource implementations.
 *
 * Production wires `@chiefaia/librarian`'s `retrievePrecedent` into the
 * Researcher's planner + synthesis prompts. Tests inject a fixture-backed
 * precedent source.
 *
 * The `@chiefaia/librarian` dependency is intentionally NOT a hard dependency
 * of `@chiefaia/researcher` — Librarian can be wired by the orchestrator at
 * construction time, OR a CLI mode can read precedent via a child-process
 * shell to `caia-librarian-retrieve`. This keeps Researcher decoupled from
 * Librarian's specific embedder/index choices.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import type { PrecedentInjection, PrecedentSource } from '../types.js';

export interface CommandLinePrecedentOptions {
  /** Binary to shell to. Default: 'caia-librarian-retrieve'. */
  binaryPath: string;
  defaultTopN?: number;
  /** Test seam. */
  spawnFn?: (
    cmd: string,
    args: readonly string[],
    opts: { encoding: 'utf-8'; timeout: number }
  ) => SpawnSyncReturns<string>;
}

export function createCommandLinePrecedentSource(
  opts: CommandLinePrecedentOptions
): PrecedentSource {
  const spawn = opts.spawnFn ?? spawnSync;
  return {
    async retrieve(
      query: string,
      qopts?: { topN?: number }
    ): Promise<PrecedentInjection[]> {
      const topN = qopts?.topN ?? opts.defaultTopN ?? 5;
      const args = ['--query', query, '--top-n', String(topN), '--json'];
      const result = spawn(opts.binaryPath, args, {
        encoding: 'utf-8',
        timeout: 15_000
      });
      if (result.error !== null && result.error !== undefined) return [];
      if (result.status !== 0) return [];
      const stdout = (result.stdout ?? '').toString();
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter(
            (r: unknown): r is PrecedentInjection =>
              typeof r === 'object' &&
              r !== null &&
              typeof (r as PrecedentInjection).path === 'string'
          )
          .map(r => ({
            path: r.path,
            slug: typeof r.slug === 'string' ? r.slug : '',
            similarity:
              typeof r.similarity === 'number' ? r.similarity : 0,
            excerpt: typeof r.excerpt === 'string' ? r.excerpt : ''
          }));
      } catch {
        return [];
      }
    }
  };
}

/** Test seam: returns canned precedent for each query. */
export function createFixturePrecedentSource(
  fixtures: ReadonlyMap<string, readonly PrecedentInjection[]>
): PrecedentSource {
  return {
    async retrieve(
      query: string,
      qopts?: { topN?: number }
    ): Promise<PrecedentInjection[]> {
      const fx = fixtures.get(query) ?? fixtures.get('*') ?? [];
      const topN = qopts?.topN ?? fx.length;
      return fx.slice(0, topN).map(p => ({ ...p }));
    }
  };
}

/** Empty source — useful when Librarian isn't wired at all. */
export function createEmptyPrecedentSource(): PrecedentSource {
  return {
    async retrieve(): Promise<PrecedentInjection[]> {
      return [];
    }
  };
}
