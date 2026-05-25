/**
 * @caia/qa-engineer/outcome-steward-adapter
 *
 * Default {@link OutcomeStewardAdapter} that wires the public
 * @caia/outcome-steward exports for a single-package cross-check.
 *
 * The hourly outcome-steward cron checks every merged package; this
 * adapter narrows that to the just-deployed package so the verifier can
 * decide pass/fail in tens of seconds rather than waiting for the next
 * hourly tick.
 *
 * Pure orchestration over outcome-steward's public surface; no metric
 * backend implementation lives here. The caller injects a `backend`
 * (PrometheusBackend, GrafanaBackend, NullBackend in degraded envs,
 * MockBackend in tests).
 */

import {
  buildAttestationMatrix,
  classifyCell,
  classify,
  joinManifestAndExpectations,
  loadPackageExpectation,
  crossCheck,
} from '@caia/outcome-steward';
import type {
  AttestationCell,
  AttestationStatus,
  BackendState,
  CrossCheckResult,
  DeployManifest,
  PackageExpectations,
} from '@caia/outcome-steward';

import type {
  OutcomeStewardAdapter,
  OutcomeStewardCheck,
  OutcomeStewardCheckOptions,
  ProductionTarget,
} from './types.js';

export interface DefaultOutcomeStewardAdapterOptions {
  /**
   * Override how we load the package's expected SLI declaration. Default
   * calls `loadPackageExpectation` against `target.packageRoot`.
   */
  readonly loadExpectations?: (
    target: ProductionTarget,
  ) => Promise<PackageExpectations | null>;
  /**
   * Optionally provide a one-entry deploy manifest. Default builds one
   * synthetically from the target so the cross-check has a row.
   */
  readonly buildManifest?: (target: ProductionTarget) => DeployManifest;
}

/**
 * Build an adapter wired to the real @caia/outcome-steward public API.
 */
export function createDefaultOutcomeStewardAdapter(
  opts: DefaultOutcomeStewardAdapterOptions = {},
): OutcomeStewardAdapter {
  const loadExpectations = opts.loadExpectations ?? defaultLoadExpectations;
  const buildManifest = opts.buildManifest ?? defaultBuildManifest;

  return {
    async check(
      target: ProductionTarget,
      opts: OutcomeStewardCheckOptions,
    ): Promise<OutcomeStewardCheck> {
      const expectations = await loadExpectations(target);
      const manifest = buildManifest(target);
      const health = await opts.backend.health();

      if (!expectations || expectations.expectedSli.length === 0) {
        return buildEmptyMatrix(target, health.backend, 'no-metric-declared');
      }
      if (health.backend === 'absent') {
        return buildEmptyMatrix(target, 'absent', 'no-metric-store');
      }

      const joined = joinManifestAndExpectations(manifest, [expectations]);
      const since = new Date(opts.now().getTime() - opts.windowHours * 3600 * 1000);
      const results: CrossCheckResult[] = [];
      for (const row of joined) {
        if (!row.expectations) continue;
        for (const sli of row.expectations.expectedSli) {
          const result = await crossCheck(opts.backend, row.entry.name, row.solutionId ?? '', sli, {
            since,
            until: opts.now(),
          });
          results.push(result);
        }
      }

      const matrix = buildAttestationMatrix(results, { backend: health.backend });
      const cells: AttestationCell[] = [];
      for (const cell of matrix.cells.values()) {
        cells.push(cell);
      }
      const relevant = cells.filter((c) => c.packageName === target.packageName);

      const summary = countByStatusPure(relevant);
      const verdict = classifyVerdict(summary, health.backend);

      return {
        backend: health.backend,
        matrix,
        relevantCells: relevant,
        summary,
        verdict,
      };
    },
  };
}

// ─── Pure helpers (exported for unit tests) ────────────────────────────────

export function countByStatusPure(
  cells: ReadonlyArray<AttestationCell>,
): OutcomeStewardCheck['summary'] {
  let green = 0;
  let yellow = 0;
  let red = 0;
  let noMetricDeclared = 0;
  let noMetricStore = 0;
  let unknown = 0;
  for (const c of cells) {
    switch (c.status) {
      case 'green': green += 1; break;
      case 'yellow': yellow += 1; break;
      case 'red': red += 1; break;
      case 'no-metric-declared': noMetricDeclared += 1; break;
      case 'no-metric-store': noMetricStore += 1; break;
      case 'unknown': unknown += 1; break;
    }
  }
  return { green, yellow, red, noMetricDeclared, noMetricStore, unknown };
}

export function classifyVerdict(
  summary: OutcomeStewardCheck['summary'],
  backend: BackendState,
): OutcomeStewardCheck['verdict'] {
  if (backend === 'absent') return 'no-metric-store';
  if (backend === 'degraded') return 'degraded';
  if (summary.red > 0) return 'red';
  if (
    summary.green === 0
    && summary.yellow === 0
    && summary.red === 0
    && summary.unknown === 0
    && summary.noMetricDeclared === 0
    && summary.noMetricStore === 0
  ) {
    // Zero cells overall: package didn't declare any SLI rows.
    return 'no-metric-declared';
  }
  if (summary.yellow > 0 || summary.unknown > 0) return 'mixed';
  if (summary.noMetricDeclared > 0 && summary.green === 0) return 'no-metric-declared';
  return 'all-green';
}

function buildEmptyMatrix(
  target: ProductionTarget,
  backend: BackendState,
  verdict: OutcomeStewardCheck['verdict'],
): OutcomeStewardCheck {
  const status: AttestationStatus =
    verdict === 'no-metric-store' ? 'no-metric-store' : 'no-metric-declared';
  const cell: AttestationCell = {
    packageName: target.packageName,
    solutionId: target.solutionId ?? '',
    sliMetric: '<none>',
    status,
    latestValue: null,
    threshold: 0,
    direction: 'gt',
    trend: 'unknown',
    trendSlopePerHour: null,
    result: null,
    note: verdict === 'no-metric-store'
      ? 'No metric backend reachable.'
      : 'Package has not declared an expectedSli.',
  };
  const cells = new Map<string, AttestationCell>();
  cells.set(`${cell.packageName}::${cell.solutionId}::${cell.sliMetric}`, cell);
  return {
    backend,
    matrix: {
      cells,
      packages: [cell.packageName],
      solutions: [cell.solutionId],
    },
    relevantCells: [cell],
    summary:
      verdict === 'no-metric-store'
        ? { green: 0, yellow: 0, red: 0, noMetricDeclared: 0, noMetricStore: 1, unknown: 0 }
        : { green: 0, yellow: 0, red: 0, noMetricDeclared: 1, noMetricStore: 0, unknown: 0 },
    verdict,
  };
}

// ─── Defaults ──────────────────────────────────────────────────────────────

async function defaultLoadExpectations(
  target: ProductionTarget,
): Promise<PackageExpectations | null> {
  if (!target.packageRoot) return null;
  try {
    return await loadPackageExpectation(target.packageRoot);
  } catch {
    return null;
  }
}

function defaultBuildManifest(target: ProductionTarget): DeployManifest {
  const entry = {
    name: target.packageName,
    ...(target.packageRoot ? { path: target.packageRoot } : {}),
    ...(target.solutionId ? { solutionId: target.solutionId } : {}),
  };
  return {
    schemaVersion: 1,
    entries: [entry],
  };
}

// Re-export so callers don't need a second import statement.
export { classifyCell, classify } from '@caia/outcome-steward';
