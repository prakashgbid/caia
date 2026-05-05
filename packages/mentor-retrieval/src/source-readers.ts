/**
 * Source-file discovery for the Mentor Phase-3 lesson index.
 *
 * Two sources at PR-1:
 *
 *   feedback   — `<memoryDir>/feedback_*.md` (durable lessons; high
 *                 signal-to-noise)
 *   proposal   — `<memoryDir>/proposals/*.md` (recent Mentor-emitted
 *                 incidents; lower s/n but useful for catching very
 *                 recent failure modes that haven't been distilled
 *                 into a `feedback_*.md` yet)
 *
 * Both are read with deterministic ordering (sorted by path) and a
 * stable schema. Failures to read individual files are NOT swallowed —
 * the index builder must surface them so a partial index doesn't
 * silently lose lessons.
 *
 * Trust boundary: memoryDir is operator-controlled. We do NOT follow
 * symlinks outside of memoryDir; we DO accept arbitrary file content
 * (markdown is freeform).
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';

import type { FsReader, SourceFile } from './types.js';

/**
 * Default real-filesystem reader. Tests inject a fake instead.
 *
 * `readDir` returns ALL relevant SourceFiles under the given memoryDir
 * (both feedback and proposals). A non-existent memoryDir yields an
 * empty array — the index just isn't built yet.
 */
export const defaultFsReader: FsReader = {
  readDir(memoryDir: string): SourceFile[] {
    const root = pathResolve(memoryDir);
    if (!existsSync(root)) return [];

    const out: SourceFile[] = [];

    // Feedback files at the memoryDir root: feedback_*.md
    let feedbackEntries: string[];
    try {
      feedbackEntries = readdirSync(root);
    } catch (e) {
      throw new Error(`failed to read memoryDir ${root}`, { cause: e });
    }
    for (const name of feedbackEntries.sort()) {
      if (!isFeedbackFile(name)) continue;
      const p = join(root, name);
      const st = statSync(p);
      if (!st.isFile()) continue;
      out.push({
        path: p,
        kind: 'feedback',
        mtimeMs: st.mtimeMs,
        size: st.size
      });
    }

    // Proposal files under proposals/
    const proposalsDir = join(root, 'proposals');
    if (existsSync(proposalsDir)) {
      let proposalEntries: string[];
      try {
        proposalEntries = readdirSync(proposalsDir);
      } catch (e) {
        throw new Error(
          `failed to read proposals dir ${proposalsDir}`,
          { cause: e }
        );
      }
      for (const name of proposalEntries.sort()) {
        if (!isProposalFile(name)) continue;
        const p = join(proposalsDir, name);
        const st = statSync(p);
        if (!st.isFile()) continue;
        out.push({
          path: p,
          kind: 'proposal',
          mtimeMs: st.mtimeMs,
          size: st.size
        });
      }
    }

    return out;
  },

  readFile(p: string): string {
    return readFileSync(p, 'utf-8');
  }
};

/**
 * A feedback file is `feedback_*.md` directly under memoryDir. We do
 * NOT pick up directives, registries, or backup files — those are
 * either too long to embed cleanly or duplicate other lessons.
 */
export function isFeedbackFile(name: string): boolean {
  if (!name.startsWith('feedback_')) return false;
  if (!name.endsWith('.md')) return false;
  if (name.includes('.bak')) return false;
  return true;
}

/**
 * A proposal file lives under `proposals/`. Filenames follow
 * `<YYYYMMDD-HHMMSS>-<slug>.md` shape per memory-writer.
 */
export function isProposalFile(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  if (name.startsWith('.')) return false;
  return true;
}

/**
 * Slugify a path for human-readable index entries. Returns the basename
 * without extension, lowercased, with non-[a-z0-9._-] collapsed to `-`.
 *
 * Example: `/x/y/feedback_pat_topic.md` -> `feedback_pat_topic`.
 */
export function pathToSlug(p: string): string {
  const basename = p.split('/').pop() ?? p;
  const noExt = basename.replace(/\.md$/, '');
  return noExt.toLowerCase().replace(/[^a-z0-9._-]+/g, '-');
}
