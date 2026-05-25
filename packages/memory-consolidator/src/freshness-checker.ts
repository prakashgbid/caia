/**
 * Freshness checker — finds:
 *  (a) stale `superseded_by:` chains (target file missing)
 *  (b) memory files that are referenced from other files but not
 *      reachable from the corpus index (`MEMORY.md` by default).
 */
import * as path from 'node:path';

import type { Finding, MemoryFile, ScanResult } from './types.js';

export function findFreshnessIssues(scan: ScanResult): Finding[] {
  const findings: Finding[] = [];
  const allRel = new Set(scan.files.map((f) => f.relPath));

  for (const file of scan.files) {
    if (file.supersededBy) {
      const candidate = resolveSupersedeTarget(file.supersededBy, scan.files);
      if (!candidate) {
        findings.push({
          kind: 'stale-supersedes',
          sourceRelPath: file.relPath,
          detail: `superseded_by: ${file.supersededBy} — target not found`,
          severity: 'warn',
        });
      }
    }
  }

  // Detect missing-index-entry: a file is referenced from another file
  // (by wiki-link or md-link) but not reachable from indexedRelPaths.
  const referenced = collectReferenced(scan, allRel);
  for (const ref of referenced) {
    if (ref === scan.indexFileRelPath) continue;
    if (!scan.indexedRelPaths.has(ref) && !scan.indexedRelPaths.has(path.posix.basename(ref))) {
      findings.push({
        kind: 'missing-index-entry',
        sourceRelPath: ref,
        detail: `referenced from other memory files but not listed in ${scan.indexFileRelPath}`,
        severity: 'warn',
      });
    }
  }
  return findings;
}

function resolveSupersedeTarget(target: string, files: MemoryFile[]): MemoryFile | null {
  const t = target.trim();
  const candidate = t.endsWith('.md') ? t : t + '.md';
  for (const f of files) {
    if (f.relPath === candidate) return f;
    if (path.posix.basename(f.relPath) === candidate) return f;
  }
  return null;
}

function collectReferenced(scan: ScanResult, allRel: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const file of scan.files) {
    for (const wl of file.wikiLinks) {
      const t = wl.endsWith('.md') ? wl : wl + '.md';
      if (allRel.has(t)) out.add(t);
      else for (const r of allRel) if (path.posix.basename(r) === t) { out.add(r); break; }
    }
    for (const ml of file.mdLinks) {
      const cleaned = ml.target.replace(/^\.\//, '').split('#')[0] ?? ml.target;
      const dir = path.posix.dirname(file.relPath);
      const candidate = path.posix.normalize(path.posix.join(dir, cleaned));
      if (allRel.has(candidate)) out.add(candidate);
      else if (allRel.has(cleaned)) out.add(cleaned);
    }
  }
  return out;
}
