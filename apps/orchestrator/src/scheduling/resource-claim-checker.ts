/**
 * Resource-claim conflict checker — BUCKET-009.
 *
 * Pure function. Given a candidate story's `claims` and the set of
 * currently-in-flight stories' claims, return whether the candidate would
 * overlap on any of {files, schemas, apiRoutes}. The `domains` axis is the
 * coarse fallback — never used to block, only to route.
 *
 * The placer calls this at executor pickup time (NOT at placement time)
 * so the check is always against the *current* in-flight set, not stale
 * placement-time state. See proposal §9.3.
 */

export interface Claims {
  files: string[];
  schemas: string[];
  apiRoutes: string[];
  domains: string[];
}

export interface ConflictResult {
  conflict: boolean;
  overlappingFiles: string[];
  overlappingSchemas: string[];
  overlappingApiRoutes: string[];
  /** First conflicting in-flight story id, if any (for surfacing). */
  blockerStoryId?: string;
}

const EMPTY_CLAIMS: Claims = { files: [], schemas: [], apiRoutes: [], domains: [] };

/** Parse the JSON payload stored in `stories.claims_json` into a Claims object. */
export function parseClaims(json: string | null | undefined): Claims {
  if (!json) return { ...EMPTY_CLAIMS };
  try {
    const parsed = JSON.parse(json) as Partial<Claims>;
    return {
      files: Array.isArray(parsed.files) ? parsed.files.filter((f) => typeof f === 'string') : [],
      schemas: Array.isArray(parsed.schemas)
        ? parsed.schemas.filter((s) => typeof s === 'string')
        : [],
      apiRoutes: Array.isArray(parsed.apiRoutes)
        ? parsed.apiRoutes.filter((s) => typeof s === 'string')
        : [],
      domains: Array.isArray(parsed.domains)
        ? parsed.domains.filter((d) => typeof d === 'string')
        : [],
    };
  } catch {
    return { ...EMPTY_CLAIMS };
  }
}

/**
 * Check whether `candidate.claims` overlaps with any in-flight story's
 * claims on files, schemas, or apiRoutes. domains alone never causes a
 * conflict — that's the coarse routing fallback.
 *
 * Returns the FIRST conflict found; the placer can decide whether to
 * defer or surface a warning. (We intentionally don't return all overlaps
 * — surfacing one root cause keeps the dashboard clean.)
 */
export function checkClaimsConflict(
  candidate: { id: string; claims: Claims },
  inFlight: Array<{ id: string; claims: Claims }>,
): ConflictResult {
  const candFiles = new Set(candidate.claims.files);
  const candSchemas = new Set(candidate.claims.schemas);
  const candApiRoutes = new Set(candidate.claims.apiRoutes);

  for (const other of inFlight) {
    if (other.id === candidate.id) continue;
    const overlappingFiles = other.claims.files.filter((f) => candFiles.has(f));
    const overlappingSchemas = other.claims.schemas.filter((s) => candSchemas.has(s));
    const overlappingApiRoutes = other.claims.apiRoutes.filter((r) => candApiRoutes.has(r));
    if (
      overlappingFiles.length > 0 ||
      overlappingSchemas.length > 0 ||
      overlappingApiRoutes.length > 0
    ) {
      return {
        conflict: true,
        overlappingFiles,
        overlappingSchemas,
        overlappingApiRoutes,
        blockerStoryId: other.id,
      };
    }
  }

  return {
    conflict: false,
    overlappingFiles: [],
    overlappingSchemas: [],
    overlappingApiRoutes: [],
  };
}

/**
 * High-risk granularity escalation. For `risk='high'` or `risk='critical'`,
 * the scheduler upgrades to require `claims.files` non-empty before the
 * story can enter the ready pool. This is what keeps two `auth` stories
 * from concurrently rewriting the same middleware. See proposal §9.3.
 */
export function requiresFineGrainedClaims(risk: string | null | undefined): boolean {
  return risk === 'high' || risk === 'critical';
}

/**
 * A candidate story passes the fine-grained-claims gate iff it has at
 * least one file claim (or non-high risk). Returns true when the gate is
 * satisfied and the story can proceed.
 */
export function passesFineGrainedClaimsGate(
  risk: string | null | undefined,
  claims: Claims,
): boolean {
  if (!requiresFineGrainedClaims(risk)) return true;
  return claims.files.length > 0;
}
