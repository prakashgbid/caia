/**
 * Memory writer — persist a SynthesizedLesson to disk under
 * `<memoryDir>/proposals/<YYYYMMDD-HHMMSS>-<slug>.md`.
 *
 * Phase-1 invariants:
 *
 *   - Writes to **proposals/** subdirectory only. Never writes to the
 *     `agent/memory/` root. Auto-promote-to-root is a Phase-1 PR-5
 *     concern, behind explicit gating.
 *   - Idempotent at the (slug, date-hour) granularity: if a proposal
 *     with the same slug already exists in the same hour bucket, the
 *     write is a no-op (returns the existing path with `created=false`).
 *   - Creates the proposals/ directory if missing.
 *   - Atomic-ish write: writes to `<path>.tmp` then renames into place
 *     so a partial proposal never appears under the canonical name.
 *
 * The "memory dir" is configurable via the caller. Production thread it
 * from `CAIA_MEMORY_DIR` env (or the platform default). Tests use tmpdir.
 *
 * Trust boundary: memoryDir comes from the caller; slug comes from the
 * synthesizer (sanitized). Both are joined with `path.join` so no
 * traversal is possible. Filenames are validated against a strict
 * `[A-Za-z0-9._-]+` regex before write to belt-and-braces against any
 * future regression in the slug builder.
 */

import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync
} from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';

import type { SynthesizedLesson } from './synthesizer.js';

/**
 * Subdirectory under the memory dir where Phase-1 proposals land. Kept
 * as a named export for tests + the LaunchAgent install script.
 */
export const PROPOSALS_SUBDIR = 'proposals';

export interface WriteProposalOptions {
  /**
   * The agent memory directory. The proposal file lands at
   * `<memoryDir>/proposals/<filename>`.
   */
  memoryDir: string;
  /** Optional override for the timestamp prefix. Defaults to now (UTC). */
  now?: Date;
}

export interface WrittenProposal {
  /** Absolute path the proposal was written to (or already existed at). */
  path: string;
  /** True if a new file was created; false if a same-content file already existed. */
  created: boolean;
  /** The exact filename (without directory). */
  filename: string;
}

/** Strict filename guard — rejects anything with traversal characters. */
const SAFE_FILENAME = /^[A-Za-z0-9._-]+\.md$/;

/**
 * Format a Date as `YYYYMMDD-HHMMSS` in UTC for use as a filename
 * prefix. Stable, sortable, no separators that conflict with shells.
 */
export function formatTimestampPrefix(d: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, '0');
  return (
    `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}` +
    `-${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}`
  );
}

/**
 * Compose the final filename from timestamp + slug.
 * `<YYYYMMDD-HHMMSS>-<slug>.md`
 */
export function buildFilename(slug: string, now: Date): string {
  return `${formatTimestampPrefix(now)}-${slug}.md`;
}

/**
 * Write a synthesized lesson to the proposals directory.
 *
 * Idempotency: if a file already exists at the target path with the
 * same content (byte-for-byte), the write is a no-op + returns
 * `created=false`. This handles the consumer's at-least-once delivery
 * gracefully (a re-run on the same event produces the same proposal).
 */
export function writeProposal(
  lesson: SynthesizedLesson,
  opts: WriteProposalOptions
): WrittenProposal {
  const memoryDir = pathResolve(opts.memoryDir);
  const proposalsDir = join(memoryDir, PROPOSALS_SUBDIR);
  if (!existsSync(proposalsDir)) {
    mkdirSync(proposalsDir, { recursive: true });
  }

  const now = opts.now ?? new Date();
  const filename = buildFilename(lesson.slug, now);

  if (!SAFE_FILENAME.test(filename)) {
    throw new Error(
      `unsafe proposal filename rejected: ${filename} (slug=${lesson.slug})`
    );
  }

  const target = join(proposalsDir, filename);

  if (existsSync(target)) {
    const existing = readFileSync(target, 'utf-8');
    if (existing === lesson.markdown) {
      return { path: target, created: false, filename };
    }
    // Content differs — append a numeric suffix until we find an unused
    // name. This is rare (would only happen if two events with the same
    // slug + same timestamp produce different bodies, e.g. distinct
    // correlation_id).
    for (let i = 2; i < 1000; i++) {
      const altName = filename.replace(/\.md$/, `-${i}.md`);
      const altPath = join(proposalsDir, altName);
      if (!existsSync(altPath)) {
        atomicWrite(altPath, lesson.markdown);
        return { path: altPath, created: true, filename: altName };
      }
    }
    throw new Error(
      `could not find unused proposal filename after 1000 tries (slug=${lesson.slug})`
    );
  }

  atomicWrite(target, lesson.markdown);
  return { path: target, created: true, filename };
}

/**
 * List existing proposals under <memoryDir>/proposals/. Returns absolute
 * paths sorted by mtime ascending (oldest first). Used by the (future)
 * Phase-1 PR-5 promote-to-feedback step + by Stage-6 verification.
 */
export function listProposals(memoryDir: string): string[] {
  const proposalsDir = join(pathResolve(memoryDir), PROPOSALS_SUBDIR);
  if (!existsSync(proposalsDir)) return [];
  const entries = readdirSync(proposalsDir);
  const withMtime = entries
    .filter((e) => e.endsWith('.md'))
    .map((e) => {
      const p = join(proposalsDir, e);
      return { path: p, mtimeMs: statSync(p).mtimeMs };
    })
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  return withMtime.map((e) => e.path);
}

/** Atomic-ish write: write to .tmp then rename. */
function atomicWrite(target: string, content: string): void {
  const tmpPath = `${target}.tmp`;
  writeFileSync(tmpPath, content, 'utf-8');
  renameSync(tmpPath, target);
}
