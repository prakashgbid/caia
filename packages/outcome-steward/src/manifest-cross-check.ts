/**
 * Manifest × metric cross-check.
 *
 * For each `(package, expectedSli)` pair: queries the metric backend
 * for samples within the SLI's freshness window, then runs three
 * checks (per spec §4.3):
 *
 *   1. **existence**  — does the series have any samples at all?
 *   2. **threshold**  — does the latest value satisfy `direction op threshold`?
 *   3. **trend**      — does the linear-regression slope match the
 *                       declared `trendDirection`?
 *
 * Emits one {@link CrossCheckResult} per (package, solution, sliMetric)
 * triple. Synthetic rows are emitted for packages that have no
 * `expectedSli` declaration — the graceful-degradation contract from
 * spec §4.3.
 */

import type {
  CrossCheckResult,
  ExpectedSli,
  MetricBackendRef,
  MetricSeries,
  PackageExpectations,
  TrendResult,
} from './types.js';
import {
  classifyTrend,
  compareThreshold,
  computeSlope,
  pickMostRecent,
  trendSatisfied,
} from './metric-collector.js';

const NO_SOLUTION = '__no_solution__';

export interface CrossCheckOptions {
  /** Now (override for tests). */
  readonly now?: () => Date;
  /** Hard timeout per backend query. */
  readonly queryTimeoutMs?: number;
}

/**
 * Cross-check one pass against the given backend.
 *
 * Input: the result of `joinManifestAndExpectations(...)`. Output: one
 * row per (package, solution, sliMetric) triple, OR — if a manifest
 * entry has no expectations declared — a synthetic single row with the
 * sliMetric `__no_metric_declared__` so the matrix can flag it as
 * `no-metric-declared` (yellow-ish neutral, not red).
 */
export async function crossCheck(
  backend: MetricBackendRef,
  rows: ReadonlyArray<{
    packageName: string;
    expectations: PackageExpectations | null;
    solutionIdFromManifest?: string;
  }>,
  opts: CrossCheckOptions = {},
): Promise<ReadonlyArray<CrossCheckResult>> {
  const now = (opts.now ?? (() => new Date()))();
  const results: CrossCheckResult[] = [];

  for (const row of rows) {
    const exp = row.expectations;
    const solutionId =
      exp?.solutionId ??
      row.solutionIdFromManifest ??
      NO_SOLUTION;

    // Graceful-degradation: synthetic row when no expectedSli declared.
    if (!exp || exp.expectedSli.length === 0) {
      results.push(syntheticNoMetricDeclared(row.packageName, solutionId));
      continue;
    }

    for (const sli of exp.expectedSli) {
      const since = computeSince(now, sli);
      let series: MetricSeries;
      try {
        series = await backend.query({
          query: sli.query,
          since,
          until: now,
          ...(opts.queryTimeoutMs !== undefined ? { timeoutMs: opts.queryTimeoutMs } : {}),
        });
      } catch {
        // Treat query errors as "no data". The classifier will mark the
        // cell `unknown` if the backend probe was `degraded`; otherwise
        // it falls through to threshold-fail / trend-fail like an empty
        // series.
        series = { query: sli.query, metric: null, samples: [], labels: {} };
      }

      results.push(buildResult(row.packageName, solutionId, sli, series));
    }
  }

  return results;
}

/**
 * Same as {@link crossCheck} but driven by an already-fetched map of
 * `query → MetricSeries`. Used by tests + by callers who want to fan
 * out their own queries.
 */
export function crossCheckFromSeries(
  rows: ReadonlyArray<{
    packageName: string;
    expectations: PackageExpectations | null;
    solutionIdFromManifest?: string;
  }>,
  seriesByQuery: ReadonlyMap<string, MetricSeries>,
): ReadonlyArray<CrossCheckResult> {
  const results: CrossCheckResult[] = [];

  for (const row of rows) {
    const exp = row.expectations;
    const solutionId =
      exp?.solutionId ??
      row.solutionIdFromManifest ??
      NO_SOLUTION;
    if (!exp || exp.expectedSli.length === 0) {
      results.push(syntheticNoMetricDeclared(row.packageName, solutionId));
      continue;
    }
    for (const sli of exp.expectedSli) {
      const series =
        seriesByQuery.get(sli.query) ?? {
          query: sli.query,
          metric: null,
          samples: [] as ReadonlyArray<readonly [number, number]>,
          labels: {},
        };
      results.push(buildResult(row.packageName, solutionId, sli, series));
    }
  }
  return results;
}

/**
 * Stable cell key for the matrix.
 */
export function sliKey(packageName: string, solutionId: string, sliMetric: string): string {
  return `${packageName}::${solutionId}::${sliMetric}`;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function computeSince(now: Date, sli: ExpectedSli): Date {
  const hours = sli.freshnessHours ?? 24;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function syntheticNoMetricDeclared(packageName: string, solutionId: string): CrossCheckResult {
  return {
    packageName,
    solutionId,
    sli: {
      metric: '__no_metric_declared__',
      query: '__no_metric_declared__',
      threshold: 0,
      direction: 'gt',
      trendDirection: 'any',
      freshnessHours: 24,
      optional: false,
    },
    latestValue: null,
    trendSlopePerHour: null,
    trend: 'unknown',
    thresholdSatisfied: false,
    trendSatisfied: false,
    metricPresent: false,
    sampleCount: 0,
    mostRecentAtIso: null,
  };
}

function buildResult(
  packageName: string,
  solutionId: string,
  sli: ExpectedSli,
  series: MetricSeries,
): CrossCheckResult {
  const recent = pickMostRecent(series);
  const latestValue = recent ? recent[1] : null;
  const sampleCount = series.samples.length;
  const metricPresent = sampleCount > 0;

  const slopePerHour = computeSlope(series.samples);
  const trend: TrendResult = classifyTrend(slopePerHour);

  const thresholdSatisfied =
    latestValue !== null && compareThreshold(latestValue, sli.direction, sli.threshold);
  const trendOk = trendSatisfied(sli.trendDirection ?? 'any', trend);

  const mostRecentAtIso = recent ? new Date(recent[0] * 1000).toISOString() : null;

  return {
    packageName,
    solutionId,
    sli,
    latestValue,
    trendSlopePerHour: slopePerHour,
    trend,
    thresholdSatisfied,
    trendSatisfied: trendOk,
    metricPresent,
    sampleCount,
    mostRecentAtIso,
  };
}
