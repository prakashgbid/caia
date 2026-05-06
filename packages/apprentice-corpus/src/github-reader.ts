/**
 * GitHub PR-history reader — uses the `gh` CLI to pull merged PRs.
 *
 * The default client shells out to `gh pr list --state merged --json …`.
 * Tests inject a fake `GithubClient` that returns canned records.
 *
 * Bounded by `maxAgeDays` to keep the API call cheap; the merged-at
 * filter is applied client-side after `gh` returns results.
 */

import { spawnSync } from 'node:child_process';

import type {
  GithubClient,
  GithubPrRecord,
  RawArtifact,
  ReaderContext,
  SourceReader
} from './types.js';

export interface GithubReaderOptions {
  client: GithubClient;
  repo: string;
}

export function createGithubReader(opts: GithubReaderOptions): SourceReader {
  return {
    source: 'github',
    async read(ctx: ReaderContext): Promise<RawArtifact[]> {
      const cutoffMs = ctx.nowMs - ctx.maxAgeDays * 24 * 60 * 60 * 1000;
      let records: GithubPrRecord[];
      try {
        records = await opts.client.listMergedPrs(cutoffMs, opts.repo);
      } catch {
        return [];
      }
      const out: RawArtifact[] = [];
      for (const r of records) {
        if (r.mergedAtMs < cutoffMs) continue;
        const text = formatPrText(r);
        if (text === '') continue;
        out.push({
          source: 'github',
          sourceId: `pr#${r.number}`,
          kind: 'PR',
          text,
          sidecar: { url: r.url, number: r.number, mergedAtMs: r.mergedAtMs },
          createdAtMs: r.mergedAtMs
        });
      }
      out.sort((a, b) => a.createdAtMs - b.createdAtMs);
      return out;
    }
  };
}

export function formatPrText(r: GithubPrRecord): string {
  const titleLine = r.title.trim();
  const body = (r.body ?? '').trim();
  if (titleLine === '' && body === '') return '';
  if (body === '') return titleLine;
  return `${titleLine}\n\n${body}`;
}

/**
 * Default real-`gh`-backed client.
 *
 * Spawns `gh pr list --repo <repo> --state merged --json
 * number,title,body,url,mergedAt --limit <N> --search "merged:>=<date>"`.
 * Returns a parsed array of records. Subprocess errors return [] so a
 * missing `gh` doesn't break the whole pipeline.
 */
export const defaultGithubClient: GithubClient = {
  async listMergedPrs(sinceMs: number, repo: string): Promise<GithubPrRecord[]> {
    const sinceDate = new Date(sinceMs).toISOString().slice(0, 10);
    const result = spawnSync(
      'gh',
      [
        'pr',
        'list',
        '--repo',
        repo,
        '--state',
        'merged',
        '--json',
        'number,title,body,url,mergedAt',
        '--limit',
        '500',
        '--search',
        `merged:>=${sinceDate}`
      ],
      { encoding: 'utf-8', timeout: 60_000 }
    );
    if (result.status !== 0 || result.stdout === '') return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(result.stdout);
    } catch {
      return [];
    }
    if (!Array.isArray(parsed)) return [];
    const out: GithubPrRecord[] = [];
    for (const p of parsed) {
      if (typeof p !== 'object' || p === null) continue;
      const obj = p as Record<string, unknown>;
      const number = typeof obj['number'] === 'number' ? obj['number'] : -1;
      const title = typeof obj['title'] === 'string' ? obj['title'] : '';
      const body = typeof obj['body'] === 'string' ? obj['body'] : '';
      const url = typeof obj['url'] === 'string' ? obj['url'] : '';
      const mergedAt = typeof obj['mergedAt'] === 'string' ? obj['mergedAt'] : '';
      if (number < 0 || mergedAt === '') continue;
      out.push({
        number,
        title,
        body,
        url,
        mergedAtMs: Date.parse(mergedAt)
      });
    }
    return out;
  }
};
