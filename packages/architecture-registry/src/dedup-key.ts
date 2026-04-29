/**
 * @chiefaia/architecture-registry — dedup key (ARCH-001)
 *
 * Idempotency for the AKG: the dedup_key column on `arch_artifacts` has a
 * UNIQUE constraint, so the AST extractor (ARCH-002), drizzle introspect
 * (ARCH-003), and any other writer can blindly upsert the same logical
 * artifact without inserting duplicates.
 *
 * Key composition: project + kind + name + most-specific-locator. Locator
 * preference order (most-specific first):
 *   - routeSignature   (kind=api)
 *   - tableName        (kind=schema|migration)
 *   - packageName      (kind=package)
 *   - entryPath        (anything with a single canonical entry file)
 *   - first(filePaths) (fallback)
 *   - empty            (conceptual artifacts: domain modules without files)
 *
 * Output: 64-char hex sha256.
 */

import { createHash } from 'node:crypto';
import type { ArtifactKind, EdgeRelation } from './schema';

export interface ArtifactDedupKeyInput {
  project: string;
  kind: ArtifactKind;
  name: string;
  routeSignature?: string | null;
  tableName?: string | null;
  packageName?: string | null;
  entryPath?: string | null;
  filePaths?: string[];
}

function norm(s: string | null | undefined): string {
  if (!s) return '';
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function computeArtifactDedupKey(input: ArtifactDedupKeyInput): string {
  const project = norm(input.project);
  const kind = norm(input.kind);
  const name = norm(input.name);
  const locator =
    norm(input.routeSignature) ||
    norm(input.tableName) ||
    norm(input.packageName) ||
    norm(input.entryPath) ||
    norm((input.filePaths ?? []).slice().sort().join('|'));

  const payload = `arch::${project}::${kind}::${name}::${locator}`;
  return createHash('sha256').update(payload).digest('hex');
}

export interface EdgeDedupKeyInput {
  fromId: string;
  toId: string;
  relation: EdgeRelation;
}

/**
 * Edge dedup key. UNIQUE on (fromId, toId, relation) — so re-extracting
 * "OrchestratorService depends_on FeatureRegistryPackage" twice doesn't
 * produce two rows.
 */
export function computeEdgeDedupKey(input: EdgeDedupKeyInput): string {
  const payload = `arch_edge::${input.fromId}::${input.toId}::${input.relation}`;
  return createHash('sha256').update(payload).digest('hex');
}
