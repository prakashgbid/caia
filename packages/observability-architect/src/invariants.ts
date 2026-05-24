/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Observability's contributions so
 * the Reviewer's `invariants-registry.ts` can collect them at process
 * boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'observability.metricsEmitted'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the
 *     `observability.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Observability package's own tests AND
 * inside the Reviewer's post-composition pass.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  /** Architect that contributed this invariant. */
  contributor: string;
  /** Other architects whose fields this invariant reads. */
  reads: readonly string[];
  /** Severity if the predicate returns false. */
  severity: InvariantSeverity;
  /** Operator-facing description for the Reviewer's audit log. */
  description: string;
  /**
   * The predicate. Receives the JSONB blob (flat-keyed
   * `architectureFields` view OR nested composed-architecture view).
   * Pure + synchronous.
   */
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

/**
 * Read a field from the architecture blob. Tries the flat dotted key
 * first (matches `architectureFields` shape), then falls back to walking
 * the nested object path (matches composed-architecture shape).
 */
function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

const PROMETHEUS_NAME_RE = /^[a-z][a-z0-9_]*_(seconds|bytes|total|ratio|count|info)$/;
const VALID_SEVERITIES = new Set(['P0', 'P1', 'P2']);
const VALID_ERROR_TRACKING_PROVIDERS = new Set(['sentry', 'rollbar', 'datadog', 'none']);

/**
 * Observability's contributed invariants. Listed in stable order.
 */
export const OBSERVABILITY_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'observability.metrics-nonempty',
    contributor: 'observability',
    reads: ['observability.metricsEmitted'],
    severity: 'fail',
    description:
      'Every Observability output must emit at least one metric. An empty `metricsEmitted` means the architect failed to project the endpoints.',
    detect(arch): boolean {
      const metrics = readField(arch, 'observability.metricsEmitted');
      return Array.isArray(metrics) && metrics.length > 0;
    }
  },
  {
    id: 'observability.metric-names-prometheus-compatible',
    contributor: 'observability',
    reads: ['observability.metricsEmitted'],
    severity: 'fail',
    description:
      'Every metric in `metricsEmitted` must have a Prometheus-compatible name (snake_case with a unit suffix: _seconds, _bytes, _total, _ratio, _count, _info).',
    detect(arch): boolean {
      const metrics = readField(arch, 'observability.metricsEmitted');
      if (!Array.isArray(metrics)) return false;
      for (const m of metrics) {
        if (typeof m !== 'object' || m === null) return false;
        const name = (m as Record<string, unknown>).name;
        if (typeof name !== 'string') return false;
        if (!PROMETHEUS_NAME_RE.test(name)) return false;
      }
      return true;
    }
  },
  {
    id: 'observability.every-sli-has-slo',
    contributor: 'observability',
    reads: ['observability.slis', 'observability.slos'],
    severity: 'fail',
    description:
      'SLO discipline is non-negotiable: every SLI declared must have at least one matching SLO entry.',
    detect(arch): boolean {
      const slis = readField(arch, 'observability.slis');
      const slos = readField(arch, 'observability.slos');
      if (typeof slis !== 'object' || slis === null) return false;
      if (!Array.isArray(slos)) return false;
      const sloSliRefs = new Set(
        slos
          .filter((s): s is Record<string, unknown> => typeof s === 'object' && s !== null)
          .map(s => s.sli)
          .filter((v): v is string => typeof v === 'string')
      );
      for (const sliKey of Object.keys(slis as Record<string, unknown>)) {
        if (!sloSliRefs.has(sliKey)) return false;
      }
      return true;
    }
  },
  {
    id: 'observability.alerts-have-runbooks',
    contributor: 'observability',
    reads: ['observability.alertingRules', 'observability.runbookReferences'],
    severity: 'fail',
    description:
      'Every alerting rule must point at a runbook so the on-call paging widget can deep-link recovery steps. Missing runbook references leave the human on call without guidance.',
    detect(arch): boolean {
      const rules = readField(arch, 'observability.alertingRules');
      const runbooks = readField(arch, 'observability.runbookReferences');
      if (!Array.isArray(rules)) return false;
      if (typeof runbooks !== 'object' || runbooks === null) return false;
      const runbookIds = new Set(Object.keys(runbooks as Record<string, unknown>));
      for (const r of rules) {
        if (typeof r !== 'object' || r === null) return false;
        const ref = (r as Record<string, unknown>).runbookRef;
        if (typeof ref !== 'string' || !runbookIds.has(ref)) return false;
      }
      return true;
    }
  },
  {
    id: 'observability.alert-severities-from-ladder',
    contributor: 'observability',
    reads: ['observability.alertingRules'],
    severity: 'fail',
    description:
      'Every alert severity must be one of {P0, P1, P2}. The severity ladder is binding — P0 pages within 5min, P1 tickets within 60min, P2 advisory.',
    detect(arch): boolean {
      const rules = readField(arch, 'observability.alertingRules');
      if (!Array.isArray(rules)) return false;
      for (const r of rules) {
        if (typeof r !== 'object' || r === null) return false;
        const sev = (r as Record<string, unknown>).severity;
        if (typeof sev !== 'string' || !VALID_SEVERITIES.has(sev)) return false;
      }
      return true;
    }
  },
  {
    id: 'observability.logging-strategy-is-structured-json',
    contributor: 'observability',
    reads: ['observability.loggingStrategy'],
    severity: 'fail',
    description:
      'The locked logger is structured JSON. `loggingStrategy.format` must be "json".',
    detect(arch): boolean {
      const ls = readField(arch, 'observability.loggingStrategy');
      if (typeof ls !== 'object' || ls === null) return false;
      const fmt = (ls as Record<string, unknown>).format;
      return fmt === 'json';
    }
  },
  {
    id: 'observability.error-tracking-provider-is-allowlisted',
    contributor: 'observability',
    reads: ['observability.errorTrackingProvider'],
    severity: 'fail',
    description:
      'Error tracking provider must be one of {sentry, rollbar, datadog, none}. No invented providers.',
    detect(arch): boolean {
      const etp = readField(arch, 'observability.errorTrackingProvider');
      if (typeof etp !== 'object' || etp === null) return false;
      const provider = (etp as Record<string, unknown>).provider;
      return typeof provider === 'string' && VALID_ERROR_TRACKING_PROVIDERS.has(provider);
    }
  },
  {
    id: 'observability.tracing-is-opentelemetry',
    contributor: 'observability',
    reads: ['observability.tracingStrategy'],
    severity: 'fail',
    description:
      'Tracing system is locked to OpenTelemetry. `tracingStrategy.system` must be "opentelemetry".',
    detect(arch): boolean {
      const ts = readField(arch, 'observability.tracingStrategy');
      if (typeof ts !== 'object' || ts === null) return false;
      const sys = (ts as Record<string, unknown>).system;
      return sys === 'opentelemetry';
    }
  },
  {
    id: 'observability.slis-reference-emitted-metrics',
    contributor: 'observability',
    reads: ['observability.slis', 'observability.metricsEmitted'],
    severity: 'advisory',
    description:
      'Every SLI should reference at least one metric that is declared in `metricsEmitted`. Untraceable SLIs cannot be computed at runtime.',
    detect(arch): boolean {
      const slis = readField(arch, 'observability.slis');
      const metrics = readField(arch, 'observability.metricsEmitted');
      if (typeof slis !== 'object' || slis === null) return true; // trivially pass if absent
      if (!Array.isArray(metrics)) return false;
      const metricNames = new Set(
        metrics
          .filter((m): m is Record<string, unknown> => typeof m === 'object' && m !== null)
          .map(m => m.name)
          .filter((n): n is string => typeof n === 'string')
      );
      for (const [, sli] of Object.entries(slis as Record<string, unknown>)) {
        if (typeof sli !== 'object' || sli === null) return false;
        const reads = (sli as Record<string, unknown>).reads;
        if (!Array.isArray(reads) || reads.length === 0) return false;
        for (const r of reads) {
          if (typeof r !== 'string' || !metricNames.has(r)) return false;
        }
      }
      return true;
    }
  }
];
