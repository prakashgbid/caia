/**
 * Supersession graph validator.
 *
 * The ADR repository's supersession links form a directed graph: ADR-X
 * supersedes ADR-Y means an edge X → Y. The Steward extends the existing
 * applySupersessions (which only writes both sides) with three quality
 * checks:
 *
 *   1. Cycles — A supersedes B, B supersedes A. Treat as an error.
 *   2. Orphans — A says it supersedes B but B isn't in the repo.
 *   3. Unidirectional — A says it supersedes B but B doesn't say it was
 *      superseded by A. Indicates a missed half-update.
 */

import type { AdrRecord, EaRepository } from '@caia/ea-architect';

import type { SupersessionGraphValidation } from './types.js';

const SUPERSEDED_BY_RE = /Superseded\s+by\s+(ADR-\d+)/i;
const SUPERSEDES_RE = /Supersedes:\s*([A-Z0-9, -]+)/i;

/** Parse the "Supersedes:" header of an ADR body. */
export function parseSupersedes(body: string): string[] {
  const match = body.match(SUPERSEDES_RE);
  if (match === null) return [];
  const ids = match[1] !== undefined ? match[1].split(/[,\s]+/).filter((s) => s.startsWith('ADR-')) : [];
  return [...new Set(ids)];
}

/** Parse "Superseded by ADR-XXX" from the Status line of an ADR body. */
export function parseSupersededBy(adr: AdrRecord): string | null {
  const m = adr.status.match(SUPERSEDED_BY_RE) ?? adr.body.match(SUPERSEDED_BY_RE);
  return m?.[1] ?? null;
}

/** Walk the supersession graph and return a structured validation. */
export function validateSupersessionGraph(repo: EaRepository): SupersessionGraphValidation {
  // Build forward edges (X supersedes Y) and backward edges (X superseded by Y).
  const forward = new Map<string, Set<string>>(); // X → set of Ys X supersedes
  const backward = new Map<string, string | null>(); // X → Y where Y supersedes X
  const knownIds = new Set<string>(repo.adrs.map((a) => a.adrId));

  const orphans: SupersessionGraphValidation['orphanedSupersedes'] = [];
  const unidirectional: SupersessionGraphValidation['unidirectionalLinks'] = [];

  for (const adr of repo.adrs) {
    const ss = parseSupersedes(adr.body);
    const set = new Set<string>();
    for (const target of ss) {
      if (!knownIds.has(target)) {
        orphans.push({ adrId: adr.adrId, supersededId: target });
      } else {
        set.add(target);
      }
    }
    if (set.size > 0) forward.set(adr.adrId, set);

    const sb = parseSupersededBy(adr);
    backward.set(adr.adrId, sb);
  }

  // Unidirectional check: every X→Y in forward should appear as
  // backward[Y] === X.
  for (const [x, ys] of forward.entries()) {
    for (const y of ys) {
      const sb = backward.get(y);
      if (sb !== x) {
        unidirectional.push({ from: x, to: y });
      }
    }
  }

  // Cycle detection via DFS on `forward`.
  const cycles: string[][] = [];
  const visited = new Set<string>();
  const stack = new Set<string>();

  function dfs(node: string, path: string[]): void {
    if (stack.has(node)) {
      // Found a cycle — extract the cycle portion of the path.
      const idx = path.indexOf(node);
      if (idx >= 0) {
        cycles.push([...path.slice(idx), node]);
      }
      return;
    }
    if (visited.has(node)) return;
    visited.add(node);
    stack.add(node);
    const next = forward.get(node) ?? new Set<string>();
    for (const m of next) dfs(m, [...path, node]);
    stack.delete(node);
  }
  for (const node of forward.keys()) dfs(node, []);

  return {
    ok: cycles.length === 0 && orphans.length === 0 && unidirectional.length === 0,
    cycles,
    orphanedSupersedes: orphans,
    unidirectionalLinks: unidirectional,
    scannedCount: repo.adrs.length
  };
}
