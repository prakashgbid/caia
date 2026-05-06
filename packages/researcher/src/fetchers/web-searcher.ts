/**
 * WebSearcher implementations.
 *
 * The Researcher package itself does NOT call Anthropic's WebSearch tool
 * directly — that's a host-side capability. Instead, the package exposes a
 * `WebSearcher` interface, and the orchestrator wires it up to whichever
 * search surface is available (WebSearch tool, a self-hosted SearxNG, or a
 * fixture map for tests).
 *
 * This file ships:
 *   1. `createCommandLineSearcher` — shells out to `caia-search` (a wrapper
 *      installed at the host), returning JSON. Used in production.
 *   2. `createFixtureSearcher` — reads pre-canned results from a fixture map.
 *      Used in tests.
 */

import { spawnSync, type SpawnSyncReturns } from 'node:child_process';

import type { SearchResult, WebSearcher } from '../types.js';

export interface CommandLineSearcherOptions {
  /** CLI binary that takes `--query "<q>" --top <k>` and emits JSON. */
  binaryPath: string;
  /** Default top-K. */
  defaultTopK?: number;
  /** Test seam. */
  spawnFn?: (
    cmd: string,
    args: readonly string[],
    opts: { encoding: 'utf-8'; timeout: number }
  ) => SpawnSyncReturns<string>;
}

export function createCommandLineSearcher(
  opts: CommandLineSearcherOptions
): WebSearcher {
  const spawn = opts.spawnFn ?? spawnSync;
  return {
    async search(
      query: string,
      qopts?: { topK?: number }
    ): Promise<SearchResult[]> {
      const topK = qopts?.topK ?? opts.defaultTopK ?? 10;
      const args = ['--query', query, '--top', String(topK)];
      const result = spawn(opts.binaryPath, args, {
        encoding: 'utf-8',
        timeout: 20_000
      });
      if (result.error !== null && result.error !== undefined) return [];
      if (result.status !== 0) return [];
      const stdout = (result.stdout ?? '').toString();
      try {
        const parsed = JSON.parse(stdout);
        if (!Array.isArray(parsed)) return [];
        return parsed
          .filter(
            (r: unknown): r is SearchResult =>
              typeof r === 'object' &&
              r !== null &&
              typeof (r as SearchResult).title === 'string' &&
              typeof (r as SearchResult).url === 'string'
          )
          .map(r => ({
            title: r.title,
            url: r.url,
            snippet: typeof r.snippet === 'string' ? r.snippet : ''
          }));
      } catch {
        return [];
      }
    }
  };
}

/** Test seam: returns canned results for each query. */
export function createFixtureSearcher(
  fixtures: ReadonlyMap<string, readonly SearchResult[]>
): WebSearcher {
  return {
    async search(
      query: string,
      qopts?: { topK?: number }
    ): Promise<SearchResult[]> {
      const fx = fixtures.get(query);
      if (fx === undefined) return [];
      const topK = qopts?.topK ?? fx.length;
      return fx.slice(0, topK).map(r => ({ ...r }));
    }
  };
}
