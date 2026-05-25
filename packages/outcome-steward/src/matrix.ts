/**
 * Attestation matrix classifier.
 *
 * Turns a flat list of {@link CrossCheckResult} into a 2D matrix keyed
 * by `${packageName}::${solutionId}::${sliMetric}` with each cell carrying
 * a classification:
 *
 *   green                 → metric present, threshold ok, trend ok
 *   yellow                → optional violation OR (threshold ok but trend wrong)
 *   red                   → metric present but threshold violated, OR
 *                           metric absent but expected
 *   no-metric-declared    → package has no expectedSli stanza (graceful)
 *   no-metric-store       → backend is absent (steward did not query)
 *   unknown               → backend is degraded (query indeterminate)
 *
 * Backend-state overrides:
 *   backend === 'absent'   → every non-synthetic cell becomes 'no-metric-store'
 *   backend === 'degraded' → every red/green cell becomes 'unknown'
 */

import type {
  AttestationCell,
  AttestationMatrix,
  AttestationStatus,
  BackendState,
  CrossCheckResult,
} from './types.js';
import { sliKey } from './manifest-cross-check.js';

export interface BuildMatrixOptions {
  readonly backend: BackendState;
}

export function buildAttestationMatrix(
  results: ReadonlyArray<CrossCheckResult>,
  opts: BuildMatrixOptions,
): AttestationMatrix {
  const cells = new Map<string, AttestationCell>();

  for (const r of results) {
    const key = sliKey(r.packageName, r.solutionId, r.sli.metric);
    cells.set(key, classifyCell(r, opts.backend));
  }

  const packageSet = new Set<string>();
  const solutionSet = new Set<string>();
  for (const c of cells.values()) {
    packageSet.add(c.packageName);
    solutionSet.add(c.solutionId);
  }

  return {
    cells,
    packages: [...packageSet].sort(),
    solutions: [...solutionSet].sort(),
  };
}

export function classifyCell(r: CrossCheckResult, backend: BackendState): AttestationCell {
  // Synthetic no-metric-declared row sails past backend overrides — it's
  // a declaration gap, not a measurement gap.
  if (r.sli.metric === '__no_metric_declared__') {
    return {
      packageName: r.packageName,
      solutionId: r.solutionId,
      sliMetric: r.sli.metric,
      status: 'no-metric-declared',
      latestValue: null,
      threshold: r.sli.threshold,
      direction: r.sli.direction,
      trend: r.trend,
      trendSlopePerHour: r.trendSlopePerHour,
      result: r,
      note: 'package has no caia.outcome.expectedSli stanza; declare one to enable attestation',
    };
  }

  // Backend absent → blanket no-metric-store; do not pretend to attest.
  if (backend === 'absent') {
    return {
      packageName: r.packageName,
      solutionId: r.solutionId,
      sliMetric: r.sli.metric,
      status: 'no-metric-store',
      latestValue: r.latestValue,
      threshold: r.sli.threshold,
      direction: r.sli.direction,
      trend: r.trend,
      trendSlopePerHour: r.trendSlopePerHour,
      result: r,
      note: 'metric backend reports absent; skipping attestation',
    };
  }

  const baseStatus: AttestationStatus = pickStatus(r);

  // Backend degraded → soften reds/greens to `unknown`.
  let status = baseStatus;
  if (backend === 'degraded' && (status === 'red' || status === 'green')) {
    status = 'unknown';
  }

  return {
    packageName: r.packageName,
    solutionId: r.solutionId,
    sliMetric: r.sli.metric,
    status,
    latestValue: r.latestValue,
    threshold: r.sli.threshold,
    direction: r.sli.direction,
    trend: r.trend,
    trendSlopePerHour: r.trendSlopePerHour,
    result: r,
    ...(status === 'unknown' ? { note: 'metric backend degraded; classification deferred' } : {}),
  };
}

function pickStatus(r: CrossCheckResult): AttestationStatus {
  // Metric entirely missing.
  if (!r.metricPresent) {
    if (r.sli.optional) return 'yellow';
    return 'red';
  }
  // Threshold gate failed.
  if (!r.thresholdSatisfied) {
    if (r.sli.optional) return 'yellow';
    return 'red';
  }
  // Threshold ok but trend gate failed → yellow (degraded signal but
  // current value is fine).
  if (!r.trendSatisfied) {
    return 'yellow';
  }
  return 'green';
}

/** Lookup helper: given a (package, solution, sliMetric), get its cell or undefined. */
export function getCell(
  matrix: AttestationMatrix,
  packageName: string,
  solutionId: string,
  sliMetric: string,
): AttestationCell | undefined {
  return matrix.cells.get(sliKey(packageName, solutionId, sliMetric));
}

/** Distribution of cells by status. */
export function countByStatus(matrix: AttestationMatrix): Record<AttestationStatus, number> {
  const counts: Record<AttestationStatus, number> = {
    green: 0,
    yellow: 0,
    red: 0,
    'no-metric-declared': 0,
    'no-metric-store': 0,
    unknown: 0,
  };
  for (const c of matrix.cells.values()) {
    counts[c.status] += 1;
  }
  return counts;
}
