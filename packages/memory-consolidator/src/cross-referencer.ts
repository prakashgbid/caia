/**
 * Cross-referencer — validates that every wiki-link and markdown-link
 * target referenced by a memory file actually resolves to a file on
 * disk. Findings are returned, not surfaced; surfacing is the
 * inbox-surfacer's job.
 */
import * as path from 'node:path';

import type { Finding, MemoryFile, ScanResult } from './types.js';

export interface CrossReferenceOptions {
  /**
   * If true, perform a case-insensitive base-name fallback when
   * resolving wiki-link targets. Defaults to true — wiki-links in
   * Obsidian-style memory trees often elide directory.
   */
  caseInsensitiveWiki?: boolean;
}

export function findBrokenReferences(scan: ScanResult, opts: CrossReferenceOptions = {}): Finding[] {
  const caseInsensitive = opts.caseInsensitiveWiki !== false;
  const allRelPaths = new Set(scan.files.map((f) => f.relPath));
  const allBasenamesLower = new Map<string, string>();
  for (const rel of allRelPaths) {
    allBasenamesLower.set(path.posix.basename(rel).toLowerCase(), rel);
  }

  const findings: Finding[] = [];
  for (const file of scan.files) {
    for (const wl of file.wikiLinks) {
      if (!resolveWikiLink(wl, allRelPaths, allBasenamesLower, caseInsensitive)) {
        findings.push({
          kind: 'broken-wikilink',
          sourceRelPath: file.relPath,
          detail: `wiki-link [[${wl}]] does not resolve`,
          severity: 'warn',
        });
      }
    }
    for (const ml of file.mdLinks) {
      if (!resolveMdLink(file, ml.target, allRelPaths)) {
        findings.push({
          kind: 'broken-mdlink',
          sourceRelPath: file.relPath,
          detail: `md-link [${ml.text}](${ml.target}) does not resolve`,
          severity: 'warn',
        });
      }
    }
  }
  return findings;
}

function resolveWikiLink(target: string, all: Set<string>, basenames: Map<string, string>, caseInsensitive: boolean): boolean {
  const t = target.trim();
  const candidate = t.endsWith('.md') ? t : t + '.md';
  if (all.has(candidate)) return true;
  // Try matching by basename anywhere in the tree.
  for (const rel of all) {
    if (path.posix.basename(rel) === candidate) return true;
  }
  if (caseInsensitive) {
    const hit = basenames.get(candidate.toLowerCase());
    if (hit) return true;
  }
  return false;
}

function resolveMdLink(file: MemoryFile, target: string, all: Set<string>): boolean {
  if (target.startsWith('http://') || target.startsWith('https://')) return true;
  const cleaned = target.replace(/^\.\//, '').replace(/\\/g, '/').split('#')[0] ?? target;
  // Try resolution relative to file's dir.
  const dir = path.posix.dirname(file.relPath);
  const rel = path.posix.normalize(path.posix.join(dir, cleaned));
  if (all.has(rel)) return true;
  // Try as absolute-from-root.
  if (all.has(cleaned)) return true;
  return false;
}
