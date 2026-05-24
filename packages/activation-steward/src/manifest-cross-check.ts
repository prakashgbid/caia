/**
 * Manifest × trace cross-check.
 *
 * For each `(package, expected callpath)` pair: queries the trace
 * backend for spans matching the callpath's service + span name within
 * its freshness window, then partitions the matches by tenant. Returns
 * one {@link CrossCheckResult} per `(package, tenant, callpath)` triple.
 *
 * "No tenants" is represented by the synthetic `__no_tenant__` tenant
 * id, which keeps the per-tenant pipeline uniform downstream.
 */

import type {
  CrossCheckResult,
  ExpectedCallPath,
  PackageExpectations,
  TraceMatch,
} from './types.js';
import type { TraceBackend } from './trace-collector.js';

const NO_TENANT = '__no_tenant__';

export interface CrossCheckOptions {
  /** Now (override for tests). */
  readonly now?: () => Date;
  /** Hard timeout per backend query. */
  readonly queryTimeoutMs?: number;
}

/**
 * Run one cross-check pass against the given backend. Returns one
 * result per `(package, tenant, callpath)` triple.
 *
 * If a callpath produces no matches at all, exactly one result row is
 * emitted with `tenantId === NO_TENANT` and `hit === false`.
 */
export async function crossCheck(
  backend: TraceBackend,
  packages: ReadonlyArray<PackageExpectations>,
  opts: CrossCheckOptions = {},
): Promise<ReadonlyArray<CrossCheckResult>> {
  const now = (opts.now ?? (() => new Date()))();
  const results: CrossCheckResult[] = [];

  for (const pkg of packages) {
    for (const cp of pkg.expectedCallPaths) {
      const since = computeSince(now, cp);
      let matches: ReadonlyArray<TraceMatch>;
      try {
        matches = await backend.query({
          serviceName: cp.serviceName,
          spanName: cp.spanName ?? defaultSpanName(cp.path),
          since,
          until: now,
          ...(opts.queryTimeoutMs !== undefined ? { timeoutMs: opts.queryTimeoutMs } : {}),
        });
      } catch {
        // Treat query errors as "no data" — the steward classifier
        // will mark cells as `unknown` if the surrounding telemetry
        // state is `degraded`; otherwise as `red`. Either way we still
        // emit a deterministic row.
        matches = [];
      }

      const byTenant = partitionMatches(matches);
      if (byTenant.size === 0) {
        results.push(emptyResult(pkg.packageName, NO_TENANT, cp));
        continue;
      }
      for (const [tenantId, tenantMatches] of byTenant) {
        results.push(buildResult(pkg.packageName, tenantId, cp, tenantMatches));
      }
    }
  }

  return results;
}

/**
 * Same as {@link crossCheck} but does not call the backend — used by
 * tests + by the run.ts orchestrator after a single backend query has
 * already been fanned out.
 */
export function crossCheckFromMatches(
  packages: ReadonlyArray<PackageExpectations>,
  matchesByCallpath: ReadonlyMap<string, ReadonlyArray<TraceMatch>>,
): ReadonlyArray<CrossCheckResult> {
  const results: CrossCheckResult[] = [];

  for (const pkg of packages) {
    for (const cp of pkg.expectedCallPaths) {
      const matches = matchesByCallpath.get(callpathKey(pkg.packageName, cp.path)) ?? [];
      const byTenant = partitionMatches(matches);
      if (byTenant.size === 0) {
        results.push(emptyResult(pkg.packageName, NO_TENANT, cp));
        continue;
      }
      for (const [tenantId, tenantMatches] of byTenant) {
        results.push(buildResult(pkg.packageName, tenantId, cp, tenantMatches));
      }
    }
  }
  return results;
}

export function callpathKey(packageName: string, callpath: string): string {
  return `${packageName}::${callpath}`;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function computeSince(now: Date, cp: ExpectedCallPath): Date {
  const hours = cp.freshnessHours ?? 24;
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

function partitionMatches(matches: ReadonlyArray<TraceMatch>): Map<string, TraceMatch[]> {
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

function emptyResult(packageName: string, tenantId: string, cp: ExpectedCallPath): CrossCheckResult {
  return {
    packageName,
    tenantId,
    callpath: cp,
    spanCount: 0,
    traceCount: 0,
    mostRecentAt: null,
    hit: false,
  };
}

function buildResult(
  packageName: string,
  tenantId: string,
  cp: ExpectedCallPath,
  matches: ReadonlyArray<TraceMatch>,
): CrossCheckResult {
  const spans = new Set<string>();
  const traces = new Set<string>();
  let mostRecent: Date | null = null;
  for (const m of matches) {
    spans.add(m.spanId);
    traces.add(m.traceId);
    if (!mostRecent || m.timestamp > mostRecent) mostRecent = m.timestamp;
  }
  return {
    packageName,
    tenantId,
    callpath: cp,
    spanCount: spans.size,
    traceCount: traces.size,
    mostRecentAt: mostRecent,
    hit: spans.size > 0,
  };
}

function defaultSpanName(path: string): string {
  const idx = path.indexOf(':');
  return idx >= 0 ? path.slice(idx + 1) : path;
}
