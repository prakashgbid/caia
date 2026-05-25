/**
 * Scanner — walks `corpusRoot`, parses every `*.md` file's YAML
 * frontmatter and extracts cross-reference candidates: wiki-links
 * (`[[name]]`) and markdown links to `.md` targets.
 *
 * The parser is intentionally permissive: malformed frontmatter does
 * NOT throw; it sets `frontmatter = null` and continues. The body is
 * always retained.
 *
 * `indexedRelPaths` is the set of files reachable from the corpus
 * index file (`MEMORY.md` by default). Cross-referencer + freshness
 * checks key off this to detect missing-index drift.
 */
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

import type { FsAdapter, MemoryFile, ScanResult } from './types.js';

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;
const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;
const MD_LINK_RE = /\[([^\]\n]+?)\]\(([^)\s]+?\.md)(?:#[^)]*)?\)/g;

export interface ScanOptions {
  corpusRoot: string;
  indexFileName?: string;
  fs: FsAdapter;
}

/**
 * Walk corpusRoot recursively and return all `*.md` files parsed.
 *
 * Skips: `node_modules/`, `.git/`, any directory beginning with `.`,
 * any file beginning with `.`. Skips files larger than 2 MB to keep
 * the run bounded — large memory files are pathological.
 */
export function scanCorpus(opts: ScanOptions): ScanResult {
  const indexFileName = opts.indexFileName ?? 'MEMORY.md';
  const files: MemoryFile[] = [];

  walk(opts.corpusRoot, opts.corpusRoot, opts.fs, files);

  const indexRel = indexFileName;
  const indexedRelPaths = new Set<string>();
  const indexFile = files.find((f) => f.relPath === indexRel);
  if (indexFile) {
    for (const wl of indexFile.wikiLinks) indexedRelPaths.add(normaliseWikiTarget(wl));
    for (const ml of indexFile.mdLinks) indexedRelPaths.add(normalisePath(ml.target));
  }

  return { files, indexedRelPaths, indexFileRelPath: indexRel };
}

function walk(dir: string, root: string, fs: FsAdapter, out: MemoryFile[]): void {
  if (!fs.isDir(dir)) return;
  const entries = fs.readDir(dir);
  for (const e of entries) {
    if (e.startsWith('.')) continue;
    if (e === 'node_modules') continue;
    const full = path.posix.join(dir, e);
    if (fs.isDir(full)) {
      walk(full, root, fs, out);
      continue;
    }
    if (!e.endsWith('.md')) continue;
    let content: string;
    try {
      content = fs.readFile(full);
    } catch {
      continue;
    }
    if (content.length > 2_000_000) continue;
    out.push(parseMemoryFile(full, root, content, safeMtime(fs, full)));
  }
}

function safeMtime(fs: FsAdapter, p: string): number {
  try { return fs.statMtimeMs(p); } catch { return 0; }
}

/**
 * Parse a single memory file. Exported so tests can construct
 * `MemoryFile` records directly without round-tripping through disk.
 */
export function parseMemoryFile(absPath: string, root: string, content: string, mtimeMs: number): MemoryFile {
  const { frontmatter, body } = splitFrontmatter(content);
  const wikiLinks: string[] = [];
  const mdLinks: { text: string; target: string }[] = [];
  for (const m of body.matchAll(WIKI_LINK_RE)) {
    const target = (m[1] ?? '').trim();
    if (target.length > 0) wikiLinks.push(target);
  }
  for (const m of body.matchAll(MD_LINK_RE)) {
    const text = (m[1] ?? '').trim();
    const target = (m[2] ?? '').trim();
    if (target.length > 0) mdLinks.push({ text, target });
  }
  const supersededBy = extractSupersededBy(frontmatter);
  const relPath = path.posix.relative(root, absPath);
  return { absPath, relPath, frontmatter, body, mtimeMs, wikiLinks, mdLinks, supersededBy };
}

function splitFrontmatter(content: string): { frontmatter: Record<string, unknown> | null; body: string } {
  const m = content.match(FRONTMATTER_RE);
  if (!m) return { frontmatter: null, body: content };
  const yaml = m[1] ?? '';
  const body = m[2] ?? '';
  try {
    const parsed = parseYaml(yaml);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return { frontmatter: parsed as Record<string, unknown>, body };
    }
    return { frontmatter: null, body };
  } catch {
    return { frontmatter: null, body };
  }
}

function extractSupersededBy(fm: Record<string, unknown> | null): string | null {
  if (!fm) return null;
  const v = fm['superseded_by'] ?? fm['supersededBy'];
  if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  return null;
}

function normaliseWikiTarget(target: string): string {
  const t = target.trim();
  if (t.endsWith('.md')) return t;
  return t + '.md';
}

function normalisePath(p: string): string {
  return p.replace(/^\.\//, '').replace(/\\/g, '/');
}
