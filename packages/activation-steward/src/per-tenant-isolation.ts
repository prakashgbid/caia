/**
 * Per-tenant attestation matrix.
 *
 * A path can be cold for one tenant and hot for another. The activation
 * steward MUST emit attestations per `(package, tenant)` — not just per
 * package — so multi-tenant deployments don't false-green when one big
 * tenant exercises a path that others never touch.
 *
 * This module turns a flat list of `CrossCheckResult` (each tagged with
 * its tenant) into a 2D matrix indexed by package × tenant, with each
 * cell carrying a classification (green/yellow/red/no-telemetry/unknown).
 *
 * Classification rules (per spec §4.2):
 *   - all expected paths hit         → green
 *   - some expected paths hit        → yellow
 *   - no expected paths hit
 *       and all expected paths are `optional`  → yellow
 *       otherwise                              → red
 *   - telemetry === 'absent'         → no-telemetry (overrides above)
 *   - telemetry === 'degraded'       → unknown      (overrides red but
 *                                                    not green/yellow)
 */

import type {
  AttestationCell,
  AttestationMatrix,
  AttestationStatus,
  CrossCheckResult,
  PackageExpectations,
  TelemetryState,
  TraceMatch,
} from './types.js';

const NO_TENANT = '__no_tenant__';

/**
 * Partition flat matches by tenant. Used at the trace-aggregation layer
 * before cross-check; the equivalent partition for `CrossCheckResult`
 * is implicit (rows are already tagged).
 */
export function partitionByTenant(
  matches: ReadonlyArray<TraceMatch>,
): ReadonlyMap<string, ReadonlyArray<TraceMatch>> {
  const out = new Map<string, TraceMatch[]>();
  for (const m of matches) {
    const tenant = m.tenantId ?? NO_TENANT;
    let bucket = out.get(tenant);
    if (!bucket) {
      bucket = [];
      out.set(tenant, bucket);
    }
    bucket.push(m);
  }
  return out;
}

export interface BuildMatrixOptions {
  readonly telemetry: TelemetryState;
  /**
   * The packages we cared about. Even if the cross-check produced
   * zero rows for a package (no expected paths defined), we still
   * surface a "no-telemetry" / "unknown" cell so the dashboard never
   * silently drops a package.
   */
  readonly packages: ReadonlyArray<PackageExpectations>;
}

/**
 * Build the per-(package, tenant) attestation matrix from the flat
 * cross-check results.
 */
export function buildAttestationMatrix(
  results: ReadonlyArray<CrossCheckResult>,
  opts: BuildMatrixOptions,
): AttestationMatrix {
  // 1. Bucket results by (package, tenant).
  const buckets = new Map<string, {
    packageName: string;
    tenantId: string;
    rows: CrossCheckResult[];
  }>();

  for (const r of results) {
    const key = cellKey(r.packageName, r.tenantId);
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { packageName: r.packageName, tenantId: r.tenantId, rows: [] };
      buckets.set(key, bucket);
    }
    bucket.rows.push(r);
  }

  // 2. Ensure every declared package has at least one cell, even if
  //    the cross-check produced no rows for it.
  for (const pkg of opts.packages) {
    const probeKey = cellKey(pkg.packageName, NO_TENANT);
    if (!buckets.has(probeKey)) {
      const present = [...buckets.values()].some((b) => b.packageName === pkg.packageName);
      if (!present) {
        buckets.set(probeKey, {
          packageName: pkg.packageName,
          tenantId: NO_TENANT,
          rows: [],
        });
      }
    }
  }

  // 3. Classify each cell.
  const cells = new Map<string, AttestationCell>();
  for (const [key, bucket] of buckets) {
    cells.set(key, classifyCell(bucket.packageName, bucket.tenantId, bucket.rows, opts.telemetry, opts.packages));
  }

  // 4. Compute dimensions.
  const tenantSet = new Set<string>();
  const packageSet = new Set<string>();
  for (const c of cells.values()) {
    tenantSet.add(c.tenantId);
    packageSet.add(c.packageName);
  }

  return {
    cells,
    tenants: [...tenantSet].sort(),
    packages: [...packageSet].sort(),
  };
}

export function classifyCell(
  packageName: string,
  tenantId: string,
  rows: ReadonlyArray<CrossCheckResult>,
  telemetry: TelemetryState,
  packages: ReadonlyArray<PackageExpectations>,
): AttestationCell {
  if (telemetry === 'absent') {
    return {
      packageName,
      tenantId,
      status: 'no-telemetry',
      expectedPathCount: countExpected(packageName, packages),
      hitPathCount: 0,
      callpathResults: rows,
      note: 'telemetry backend reports absent; skipping attestation',
    };
  }

  // Use the declared count of expected paths for this package (not the
  // count of rows, which can be inflated by tenant fan-out).
  const expectedCount = countExpected(packageName, packages);

  // Hit count = distinct expected paths that have at least one row with
  // `hit === true` for this (package, tenant) cell.
  const hitPaths = new Set<string>();
  const allPaths = new Set<string>();
  let allOptional = true;
  for (const r of rows) {
    allPaths.add(r.callpath.path);
    if (!r.callpath.optional) allOptional = false;
    if (r.hit) hitPaths.add(r.callpath.path);
  }
  // If this cell has no rows at all (synthetic no-tenant cell for a
  // package with no telemetry yet), use the package's declared list.
  if (rows.length === 0) {
    const pkg = packages.find((p) => p.packageName === packageName);
    if (pkg) {
      for (const cp of pkg.expectedCallPaths) {
        allPaths.add(cp.path);
        if (!cp.optional) allOptional = false;
      }
    }
  }

  let status: AttestationStatus;
  if (hitPaths.size === 0 && expectedCount === 0) {
    // No expectations declared at all — nothing to attest. Neutral.
    status = telemetry === 'degraded' ? 'unknown' : 'yellow';
  } else if (hitPaths.size === expectedCount && expectedCount > 0) {
    status = 'green';
  } else if (hitPaths.size > 0) {
    status = 'yellow';
  } else {
    // No paths hit.
    if (allOptional && allPaths.size > 0) status = 'yellow';
    else status = telemetry === 'degraded' ? 'unknown' : 'red';
  }

  return {
    packageName,
    tenantId,
    status,
    expectedPathCount: expectedCount,
    hitPathCount: hitPaths.size,
    callpathResults: rows,
    ...(status === 'unknown' ? { note: 'telemetry degraded; classification deferred' } : {}),
  };
}

/** Lookup helper: given a (package, tenant), get its cell or undefined. */
export function getCell(
  matrix: AttestationMatrix,
  packageName: string,
  tenantId: string,
): AttestationCell | undefined {
  return matrix.cells.get(cellKey(packageName, tenantId));
}

/** Count of red cells in the matrix (excluding no-telemetry + unknown). */
export function countByStatus(matrix: AttestationMatrix): Record<AttestationStatus, number> {
  const counts: Record<AttestationStatus, number> = {
    green: 0,
    yellow: 0,
    red: 0,
    'no-telemetry': 0,
    unknown: 0,
  };
  for (const c of matrix.cells.values()) {
    counts[c.status] += 1;
  }
  return counts;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function cellKey(packageName: string, tenantId: string): string {
  return `${packageName}::${tenantId}`;
}

function countExpected(packageName: string, packages: ReadonlyArray<PackageExpectations>): number {
  const pkg = packages.find((p) => p.packageName === packageName);
  return pkg ? pkg.expectedCallPaths.length : 0;
}
