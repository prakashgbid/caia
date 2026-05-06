/**
 * Reports-walker — reads `<reportsRoot>/*.md` (handoffs, completion
 * reports, analyses).
 *
 * Reports are diverse — some are dense narrative, some are structured
 * summaries. The walker stays light: read the file, strip frontmatter
 * if present, emit. The normaliser decides what to do with the body.
 */

import { join } from 'node:path';

import { isEligibleMarkdown, parseMarkdown } from './memory-walker.js';
import type { FsReader, RawArtifact, ReaderContext, SourceReader } from './types.js';

export interface ReportsWalkerOptions {
  reportsRoot: string;
  fs: FsReader;
}

export function createReportsWalker(opts: ReportsWalkerOptions): SourceReader {
  return {
    source: 'reports',
    async read(ctx: ReaderContext): Promise<RawArtifact[]> {
      const out: RawArtifact[] = [];
      const root = opts.reportsRoot;
      if (!opts.fs.exists(root)) return out;
      const cutoffMs = ctx.nowMs - ctx.maxAgeDays * 24 * 60 * 60 * 1000;
      let entries: string[];
      try {
        entries = opts.fs.readDir(root);
      } catch {
        return out;
      }
      for (const name of entries) {
        if (!isEligibleMarkdown(name)) continue;
        const p = join(root, name);
        let st;
        try {
          st = opts.fs.stat(p);
        } catch {
          continue;
        }
        if (!st.isFile) continue;
        if (st.mtimeMs < cutoffMs) continue;
        let raw: string;
        try {
          raw = opts.fs.readFile(p);
        } catch {
          continue;
        }
        const parsed = parseMarkdown(raw);
        out.push({
          source: 'reports',
          sourceId: p,
          kind: 'report',
          text: parsed.body,
          sidecar: parsed.frontmatter,
          createdAtMs: st.mtimeMs
        });
      }
      out.sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
      return out;
    }
  };
}
