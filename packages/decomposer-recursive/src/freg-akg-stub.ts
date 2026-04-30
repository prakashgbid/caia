/**
 * FREG + AKG substrate query stubs (P0).
 *
 * In P1 these will be replaced by real calls to:
 *   - `searchAndLog` from @chiefaia/feature-registry (for FREG hits)
 *   - `archSearch` from @chiefaia/architecture-registry (for AKG hits)
 *
 * For P0 they always return an empty list — the decomposer engine
 * still wires the substrate-context block into the prompt envelope so
 * P1 only has to swap the stub for the real call. The lifecycle
 * default is therefore always `'new'` in P0.
 */

import type { ExistingArtifactRef } from './types.js';

export interface FregAkgQueryInput {
  /** Title + description of the parent ticket. */
  query: string;
  /** Project slug, used to scope FREG. */
  projectSlug?: string;
  /** Tech sub-domains the parent implies (used to scope AKG). */
  techSubDomains?: string[];
}

export interface FregAkgQueryResult {
  fregHits: ExistingArtifactRef[];
  akgHits: ExistingArtifactRef[];
}

/**
 * P0 stub — returns empty FREG + AKG hits for every query.
 * Wired so PR 5's validation suite doesn't break on real prompts.
 */
export async function querySubstrateStub(
  _input: FregAkgQueryInput,
): Promise<FregAkgQueryResult> {
  // P0: stub. P1 wires real registries.
  // TODO(po-decomp-p1): replace with real FREG + AKG queries.
  return Promise.resolve({ fregHits: [], akgHits: [] });
}

/**
 * Format substrate hits into a markdown block to inject into the
 * decomposer prompt envelope. Empty strings are returned for empty
 * hit-lists (the prompt envelope omits empty sections).
 */
export function formatFregHitsForPrompt(hits: ExistingArtifactRef[]): string {
  if (hits.length === 0) return '';
  const lines = hits.map(
    (h) => ` - ${h.id} (score ${h.score.toFixed(2)}): ${h.name}${h.hint ? ' — ' + h.hint : ''}`,
  );
  return `## EXISTING FEATURES (FREG)\n${lines.join('\n')}\n`;
}

export function formatAkgHitsForPrompt(hits: ExistingArtifactRef[]): string {
  if (hits.length === 0) return '';
  const lines = hits.map(
    (h) => ` - ${h.id} (${h.hint ?? 'artifact'}): ${h.name}`,
  );
  return `## EXISTING ARCHITECTURE (AKG)\n${lines.join('\n')}\n`;
}
