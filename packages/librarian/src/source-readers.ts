/**
 * Source-file discovery for Librarian Phase-1.
 *
 * Walks two roots:
 *
 *   memoryDir   — a directory of agent-memory markdowns (directives,
 *                 feedback, proposals, registries, architecture refs,
 *                 master plans, landscape research, etc.). Files at the
 *                 root + everything under `proposals/` are eligible.
 *
 *   reportsDir  — a directory of work logs (handoffs, completion
 *                 reports, analyses). Default `~/Documents/projects/reports`.
 *                 Optional and may be omitted; missing reportsDir is
 *                 NOT a hard failure.
 *
 * Each emitted SourceFile carries a `kind` classification computed
 * deterministically from the filename + parent directory. The kind set
 * is closed (see types.ts); files that don't match any pattern are
 * classified `other` and indexed regardless. The retrieval layer
 * exposes a kind filter for callers that want only directives, only
 * reports, etc.
 *
 * Exclusions:
 *   - `MEMORY.md` (the index of memory files; would inflate similarity
 *     against any prompt that mentions memory).
 *   - Backup files (anything containing `.bak`).
 *   - Hidden files (starting with `.`).
 *   - Non-`.md` files.
 *   - The Librarian + Mentor index DBs (`_*.sqlite*`).
 *   - Files outside the configured roots (no symlink following).
 *
 * Failures to read individual files are NOT swallowed — the index
 * builder must surface them so a partial index doesn't silently lose
 * decisions.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve as pathResolve } from 'node:path';

import type { FsReader, PrecedentKind, SourceFile, SourceRoots } from './types.js';

/**
 * Default reports directory. Mirrors the operator's standing layout
 * documented in `feedback_pr_lifecycle_and_branching.md`.
 */
export function defaultReportsDir(): string {
  return join(homedir(), 'Documents', 'projects', 'reports');
}

/**
 * Default real-filesystem reader. Tests inject a fake instead.
 *
 * Aggregates qualifying files from both roots into one deterministically
 * ordered list (sorted by absolute path for stable diffs).
 */
export const defaultFsReader: FsReader = {
  readDir(roots: SourceRoots): SourceFile[] {
    const out: SourceFile[] = [];
    walkMemoryDir(roots.memoryDir, out);
    if (roots.reportsDir !== undefined && roots.reportsDir !== '') {
      walkReportsDir(roots.reportsDir, out);
    }
    out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    return out;
  },

  readFile(p: string): string {
    return readFileSync(p, 'utf-8');
  }
};

/** Walk the memoryDir + its `proposals/` subfolder. */
function walkMemoryDir(memoryDir: string, out: SourceFile[]): void {
  const root = pathResolve(memoryDir);
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (e) {
    throw new Error(`failed to read memoryDir ${root}`, { cause: e });
  }
  for (const name of entries) {
    if (!isEligibleMarkdown(name)) continue;
    const p = join(root, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({
      path: p,
      kind: pathToKind(p),
      mtimeMs: st.mtimeMs,
      size: st.size
    });
  }

  // Proposals subdir (if present)
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
    for (const name of proposalEntries) {
      if (!isEligibleMarkdown(name)) continue;
      const p = join(proposalsDir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (!st.isFile()) continue;
      out.push({
        path: p,
        kind: 'proposal',
        mtimeMs: st.mtimeMs,
        size: st.size
      });
    }
  }
}

/** Walk the reportsDir (flat, no recursion). */
function walkReportsDir(reportsDir: string, out: SourceFile[]): void {
  const root = pathResolve(reportsDir);
  if (!existsSync(root)) return;

  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch (e) {
    throw new Error(`failed to read reportsDir ${root}`, { cause: e });
  }
  for (const name of entries) {
    if (!isEligibleMarkdown(name)) continue;
    const p = join(root, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    out.push({
      path: p,
      kind: 'report',
      mtimeMs: st.mtimeMs,
      size: st.size
    });
  }
}

/**
 * True if `name` is a markdown file we want to index.
 *
 * Excludes:
 *   - Anything not ending in `.md`
 *   - Hidden files (starting with `.`)
 *   - Backup files (containing `.bak`)
 *   - The MEMORY.md root index (a meta-index, not novel content)
 */
export function isEligibleMarkdown(name: string): boolean {
  if (!name.endsWith('.md')) return false;
  if (name.startsWith('.')) return false;
  if (name.includes('.bak')) return false;
  if (name === 'MEMORY.md') return false;
  return true;
}

/**
 * Classify a source path into a PrecedentKind based on filename
 * patterns. The classification is informational + filterable; unknown
 * patterns fall back to `other` (still indexed, still retrievable).
 *
 * Examples:
 *   `<memoryDir>/mentor_agent_directive.md`        -> 'directive'
 *   `<memoryDir>/feedback_pat_topic.md`            -> 'feedback'
 *   `<memoryDir>/proposals/20260505-00-foo.md`     -> 'proposal'
 *   `<memoryDir>/agent_contract_registry_directive.md` -> 'registry'
 *   `<memoryDir>/caia_architecture.md`             -> 'architecture'
 *   `<memoryDir>/master_backlog_sequencing_*.md`   -> 'master'
 *   `<memoryDir>/enterprise_ai_landscape_directive.md` -> 'landscape'
 *   `<memoryDir>/gate_completion_status_*.md`      -> 'gate'
 *   `<reportsDir>/principal-overnight-shipped-*.md`-> 'report'
 */
export function pathToKind(absolutePath: string): PrecedentKind {
  const norm = absolutePath.replace(/\\/g, '/');
  const segments = norm.split('/');
  const basename = segments[segments.length - 1] ?? norm;
  const parent = segments[segments.length - 2] ?? '';

  // Reports dir wins regardless of filename patterns (handoff filenames
  // sometimes start with `feedback-` or `master-` casual-style; we pin
  // them to 'report' since their location is authoritative).
  if (parent === 'reports') return 'report';

  // proposals/ subfolder under memoryDir
  if (parent === 'proposals') return 'proposal';

  // Order matters — more specific first.
  if (/^feedback_/.test(basename)) return 'feedback';
  if (/_registry(_directive)?\.md$/.test(basename)) return 'registry';
  if (/_architecture\.md$/.test(basename)) return 'architecture';
  if (/^architecture/.test(basename)) return 'architecture';
  if (/_landscape/.test(basename) || /^enterprise_/.test(basename)) {
    return 'landscape';
  }
  if (/^master_/.test(basename)) return 'master';
  if (/^gate_/.test(basename) || /^evidence_/.test(basename)) return 'gate';
  if (/^consolidation_/.test(basename)) return 'consolidation';
  if (/^daemon_/.test(basename)) return 'daemon';
  if (/^cci_/.test(basename)) return 'cci';
  if (/^mac_/.test(basename)) return 'mac';
  if (/^mcp_/.test(basename)) return 'mcp';
  if (/^safety_/.test(basename)) return 'safety';
  if (/^phase/.test(basename)) return 'phase';
  if (/^backlog_/.test(basename)) return 'backlog';
  if (/^caia_/.test(basename) || /^orchestrator_/.test(basename)) {
    return 'team';
  }
  if (/_directive\.md$/.test(basename)) return 'directive';

  return 'other';
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
