/**
 * Memory-walker — reads `<memoryRoot>/*.md` (and `proposals/*.md`) and
 * classifies each file by filename pattern.
 *
 * Mirrors the conventions of `@chiefaia/librarian`'s `pathToKind`, but
 * without depending on the librarian package directly (the librarian's
 * classifier is internal; we keep this independent so refactors there
 * don't ripple here).
 */

import { join } from 'node:path';

import type { FsReader, RawArtifact, ReaderContext, SourceReader } from './types.js';

/** Stripped frontmatter + raw body. */
export interface ParsedMarkdown {
  frontmatter: Record<string, string>;
  body: string;
}

/**
 * Operator-voice directive prefixes — basenames matching these patterns
 * are classified as `directive` so the quality rubric's +0.2
 * operator-voice bonus applies. These prefixes name handoff/landing/
 * phase records that the operator writes in the same voice as explicit
 * `_directive.md` files. Pre-2026-05-14 the matcher only recognised
 * `*directive*` / `feedback_*`, so phase-handoff records (`_phaseN_*`,
 * `apprentice_*`, `b15_*`, `t25_*`, `r_*`) fell through to `other` and
 * lost the bonus despite being the highest-signal operator content in
 * the corpus.
 */
const DIRECTIVE_PREFIXES: ReadonlyArray<string> = Object.freeze([
  '_phase',
  'apprentice_',
  'b15_',
  't25_',
  'r_'
]);

/** Classify a memory file by basename. */
export function classifyMemoryFile(basename: string): string {
  const name = basename.toLowerCase();

  if (name.endsWith('_directive.md') || name.includes('directive')) return 'directive';
  for (const prefix of DIRECTIVE_PREFIXES) {
    if (name.startsWith(prefix)) return 'directive';
  }
  if (name.startsWith('feedback_')) return 'feedback';
  if (name.startsWith('proposal_') || name.includes('proposals/')) return 'proposal';
  if (name.includes('registry')) return 'registry';
  if (name.includes('architecture')) return 'architecture';
  if (name.startsWith('master_')) return 'master';
  if (name.includes('landscape')) return 'landscape';
  if (name.startsWith('gate_') || name.startsWith('evidence_')) return 'gate';
  if (name.startsWith('consolidation_')) return 'consolidation';
  if (name.startsWith('daemon_')) return 'daemon';
  if (name.startsWith('cci_')) return 'cci';
  if (name.startsWith('mac_')) return 'mac';
  if (name.startsWith('mcp_')) return 'mcp';
  if (name.startsWith('safety_')) return 'safety';
  if (name.startsWith('phase')) return 'phase';
  if (name.startsWith('caia_') || name.startsWith('orchestrator_')) return 'team';
  if (name.startsWith('backlog_')) return 'backlog';
  return 'other';
}

/** Strip simple `---\n...\n---\n` YAML frontmatter; tolerant to absence. */
export function parseMarkdown(raw: string): ParsedMarkdown {
  const frontmatter: Record<string, string> = {};
  if (!raw.startsWith('---')) {
    return { frontmatter, body: raw };
  }
  const closeIdx = raw.indexOf('\n---', 3);
  if (closeIdx === -1) return { frontmatter, body: raw };
  const fm = raw.slice(3, closeIdx).trim();
  for (const line of fm.split('\n')) {
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    const value = line.slice(colon + 1).trim();
    if (key) frontmatter[key] = value;
  }
  // After `\n---` skip the next newline if any
  let bodyStart = closeIdx + 4;
  if (raw[bodyStart] === '\n') bodyStart += 1;
  return { frontmatter, body: raw.slice(bodyStart) };
}

/** Predicate: should this filename be ingested? */
export function isEligibleMarkdown(basename: string): boolean {
  if (!basename.endsWith('.md')) return false;
  if (basename.startsWith('.')) return false;
  if (basename.includes('.bak')) return false;
  // MEMORY.md is the index — would inflate similarity and add nothing
  if (basename === 'MEMORY.md') return false;
  return true;
}

export interface MemoryWalkerOptions {
  memoryRoot: string;
  fs: FsReader;
}

/** Build the memory-walker source reader. */
export function createMemoryWalker(opts: MemoryWalkerOptions): SourceReader {
  return {
    source: 'memory',
    async read(ctx: ReaderContext): Promise<RawArtifact[]> {
      const out: RawArtifact[] = [];
      walkMemoryRoot(opts.memoryRoot, opts.fs, ctx, out);
      // Sort for deterministic ordering across runs / platforms
      out.sort((a, b) => (a.sourceId < b.sourceId ? -1 : a.sourceId > b.sourceId ? 1 : 0));
      return out;
    }
  };
}

function walkMemoryRoot(
  root: string,
  fs: FsReader,
  ctx: ReaderContext,
  out: RawArtifact[]
): void {
  if (!fs.exists(root)) return;
  const cutoffMs = ctx.nowMs - ctx.maxAgeDays * 24 * 60 * 60 * 1000;
  let entries: string[];
  try {
    entries = fs.readDir(root);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!isEligibleMarkdown(name)) {
      // descend into proposals/ even though it's not a markdown
      if (name === 'proposals') {
        const sub = join(root, name);
        if (fs.exists(sub)) walkProposals(sub, fs, ctx, cutoffMs, out);
      }
      continue;
    }
    const p = join(root, name);
    appendMemoryFile(p, name, fs, cutoffMs, out);
  }
}

function walkProposals(
  dir: string,
  fs: FsReader,
  _ctx: ReaderContext,
  cutoffMs: number,
  out: RawArtifact[]
): void {
  let entries: string[];
  try {
    entries = fs.readDir(dir);
  } catch {
    return;
  }
  for (const name of entries) {
    if (!isEligibleMarkdown(name)) continue;
    const p = join(dir, name);
    appendMemoryFile(p, name, fs, cutoffMs, out);
  }
}

function appendMemoryFile(
  path: string,
  basename: string,
  fs: FsReader,
  cutoffMs: number,
  out: RawArtifact[]
): void {
  let st;
  try {
    st = fs.stat(path);
  } catch {
    return;
  }
  if (!st.isFile) return;
  if (st.mtimeMs < cutoffMs) return;
  let raw: string;
  try {
    raw = fs.readFile(path);
  } catch {
    return;
  }
  const parsed = parseMarkdown(raw);
  out.push({
    source: 'memory',
    sourceId: path,
    kind: classifyMemoryFile(basename),
    text: parsed.body,
    sidecar: parsed.frontmatter,
    createdAtMs: st.mtimeMs
  });
}
