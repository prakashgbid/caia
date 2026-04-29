/**
 * @chiefaia/feature-registry — dedup key (FREG-001)
 *
 * Idempotency for the registry: the dedup_key column has a UNIQUE
 * constraint, so the story.completed subscriber and backfill script can
 * blindly upsert the same logical feature without inserting duplicates.
 *
 * Key composition: project + name + (route_path || component_name ||
 * agent_name || api_endpoint || file_paths_canonical). Whatever locator
 * uniquely identifies the feature within the project. We hash the
 * concatenation so two different callers building the same logical
 * feature get the same key regardless of which locator field they
 * happened to populate first.
 */

import { createHash } from 'node:crypto';

export interface DedupKeyInput {
  project: string;
  name: string;
  routePath?: string | null;
  componentName?: string | null;
  apiEndpoint?: string | null;
  agentName?: string | null;
  filePaths?: string[];
}

/**
 * Lowercase + trim + collapse whitespace. Defends against the same
 * feature being seeded once with `' /Leaderboard '` and once with
 * `'/leaderboard'`.
 */
function norm(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Compute a stable, idempotent dedup key for a registry row.
 *
 * Output: 64-char hex sha256 string. Stable across processes / language
 * runtimes / order of locator-field population.
 */
export function computeDedupKey(input: DedupKeyInput): string {
  const project = norm(input.project);
  const name = norm(input.name);
  // Locator preference order: most specific first. We use the FIRST
  // populated locator to define the key — using all of them would mean a
  // row partially populated by story.completed and later enriched by
  // backfill would get a different key than the original.
  const locator =
    norm(input.routePath) ||
    norm(input.apiEndpoint) ||
    norm(input.componentName) ||
    norm(input.agentName) ||
    norm((input.filePaths ?? []).slice().sort().join('|'));

  const payload = `${project}::${name}::${locator}`;
  return createHash('sha256').update(payload).digest('hex');
}
