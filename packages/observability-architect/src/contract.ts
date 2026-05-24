/**
 * `ObservabilityArchitectContract` — the canonical owned-fields
 * declaration for architect #9 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.9 (Observability Architect owns `observability.*`)
 *   - task brief (loggingStrategy, errorTrackingProvider, tracingStrategy,
 *     metricsEmitted, slis, slos, alertingRules, dashboardSpec,
 *     runbookReferences)
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. All chosen keys live under the `observability.*`
 * namespace and do not collide with any sibling architect's namespace.
 *
 * Naming note: the spec §2.9 outline lists field names like `logShape`,
 * `metricsExport`, `traceSpans`, `alertRules`, `sloTargets`,
 * `dashboards`, `errorBoundaries`, `runbookRefs`. The task brief uses
 * `loggingStrategy`, `errorTrackingProvider`, `tracingStrategy`,
 * `metricsEmitted`, `slis`, `slos`, `alertingRules`, `dashboardSpec`,
 * `runbookReferences`. The task brief is the binding name set (per
 * standing rule — newer brief wins); the spec outline guides the
 * semantic content of each field. The contract id stays `v1`.
 *
 * Existing tooling: the architect's output mirrors the canonical shapes
 * exposed by `@chiefaia/tracing` (OTel span conventions),
 * `@chiefaia/metrics` (Prometheus-style metric names + label set), and
 * `@chiefaia/logger` (structured JSON log shape with stable keys). The
 * architect does not write code that imports those packages; it
 * specifies fields that downstream coding workers (and the runtime) will
 * use to wire them up.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the fix-hint
 * dictionary lives next to the contract so the system-prompt builder and
 * the future EA Reviewer can surface it without changing kit shape.
 */
export const OBSERVABILITY_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'observability.loggingStrategy':
    'Default to structured JSON (one event per line) with stable keys: timestamp, level, message, request_id, tenant_id, route, status_code, duration_ms. Mirror @chiefaia/logger conventions. Declare per-endpoint log levels (info on success, warn on 4xx, error on 5xx). Log routing: stdout (Cloudflare → tail consumer) for the canonical sink.',
  'observability.errorTrackingProvider':
    'Default to Sentry. The provider must support source-mapped stack traces, release tagging, per-tenant scope, and a "fingerprint" that groups by errorEnvelope.code. Customer override allowed: Rollbar, Datadog APM, or "none" for offline tenants. Never invent a provider not in {sentry, rollbar, datadog, none}.',
  'observability.tracingStrategy':
    'OpenTelemetry; spans named `<METHOD> <route-pattern>` at the route handler boundary, plus child spans for db.query, cache.get, external.fetch. Use semantic conventions: http.request.method, http.route, http.response.status_code, db.system, db.statement. Propagate W3C traceparent across service boundaries. Sampling: tail-based 100% on 5xx, head-based 10% on success.',
  'observability.metricsEmitted':
    'Prometheus-compatible metric names. Per endpoint: `http_request_duration_seconds` (histogram, labels: method, route, status_class), `http_requests_total` (counter, labels: method, route, status_code, tenant_id), `http_request_size_bytes`, `http_response_size_bytes`. Plus business metrics derived from `apiEndpoints`. Never invent metric names that violate Prometheus naming rules (snake_case, _seconds/_bytes/_total suffixes).',
  'observability.slis':
    'Service Level Indicators — measurable per-endpoint signals derived from `metricsEmitted`. Default set: availability (success_total / total), latency_p95 (histogram quantile), latency_p99, error_rate (5xx_total / total). Each SLI must reference at least one metric name from `metricsEmitted`.',
  'observability.slos':
    'Service Level Objectives — thresholds on SLIs over a rolling window. Default targets: 99.5% availability over 30 days, p95 < 500ms over 7 days for read endpoints, p95 < 1000ms for write endpoints, error_rate < 0.5% over 7 days. Every SLI must have at least one SLO. SLOs are non-default-skipped — always declare them.',
  'observability.alertingRules':
    'Severity ladder: P0 pages within 5 minutes (availability < 99% over 5min, error_rate > 5% over 5min); P1 tickets within 60 minutes (latency_p95 breaches over 15min, SLO burn-rate > 10x); P2 advisory (capacity headroom warnings). Each rule: id, metric, threshold, window, severity, runbookRef.',
  'observability.dashboardSpec':
    'Per-route Grafana iframe panels. Default 4-panel layout: (1) request rate per status_class, (2) latency p50/p95/p99, (3) error rate over time, (4) SLO burn rate. Reference metric names from `metricsEmitted`. The Atlas-rendered dashboard URL is computed downstream; this field declares the panel taxonomy.',
  'observability.runbookReferences':
    'Per-alert recovery steps keyed by alertingRules[].id (and per errorEnvelope.mapping[].code where relevant). Each entry: stepsMarkdown URL or inline bullet list, escalation owner, expected MTTR. Runbook IDs follow the form `rb-<service>-<error-code>` so the on-call paging widget can deep-link.'
};

/**
 * The owned section specs in stable order.
 */
export const OBSERVABILITY_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'observability.loggingStrategy',
    description:
      'Structured-log contract: log shape (JSON keys), per-endpoint log levels, log routing destinations. Mirrors @chiefaia/logger conventions. The single source of truth for what gets logged for every request.',
    required: true
  },
  {
    path: 'observability.errorTrackingProvider',
    description:
      'Error tracking provider configuration (Sentry / Rollbar / Datadog / customer override). Fingerprint strategy, release tagging, per-tenant scope, source-map upload posture.',
    required: true
  },
  {
    path: 'observability.tracingStrategy',
    description:
      'OpenTelemetry tracing strategy: span naming convention, semantic-convention attributes, sampling posture (head + tail), context propagation. Mirrors @chiefaia/tracing conventions.',
    required: true
  },
  {
    path: 'observability.metricsEmitted',
    description:
      'Prometheus-compatible metric names + label sets emitted per endpoint and per business event. Mirrors @chiefaia/metrics conventions. Drives `slis` and `dashboardSpec`.',
    required: true
  },
  {
    path: 'observability.slis',
    description:
      'Service Level Indicators — measurable per-endpoint signals derived from `metricsEmitted`. Availability, latency quantiles, error rate. Each SLI references the metric(s) it reads.',
    required: true
  },
  {
    path: 'observability.slos',
    description:
      'Service Level Objectives — thresholds on SLIs over rolling windows. Always declared (never default-skipped). Every SLI must have at least one SLO.',
    required: true
  },
  {
    path: 'observability.alertingRules',
    description:
      'Severity-laddered alert rules (P0 page / P1 ticket / P2 advisory). Each rule cites the metric, threshold, window, severity, and runbook reference.',
    required: true
  },
  {
    path: 'observability.dashboardSpec',
    description:
      'Grafana iframe panel taxonomy per route. Default 4-panel layout: request rate by status, latency quantiles, error rate, SLO burn rate. References metric names from `metricsEmitted`.',
    required: true
  },
  {
    path: 'observability.runbookReferences',
    description:
      'Per-alert + per-error-code recovery steps. Each entry: runbook id, steps source (URL or inline markdown), escalation owner, expected MTTR.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const OBSERVABILITY_OWNED_FIELD_KEYS: readonly string[] =
  OBSERVABILITY_OWNED_SECTIONS.map(s => s.path);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.9 — Observability runs on every ticket that ships runtime
 * code: any ticket Backend covers (Page, Story, Form, List, Foundation,
 * and Widget tickets tagged `api`/`backend`/`persists`). Observability
 * does not apply to purely visual Widget tickets (no endpoints, no
 * runtime code → nothing to log/trace/alert on).
 */
export function observabilityArchitectAppliesPredicate(ticket: Ticket): boolean {
  if (
    ticket.type === 'Page' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List' ||
    ticket.type === 'Foundation'
  ) {
    return true;
  }
  if (ticket.type === 'Widget') {
    const tags = ticket.quality_tags ?? [];
    return (
      tags.includes('api') ||
      tags.includes('backend') ||
      tags.includes('persists') ||
      tags.includes('observability')
    );
  }
  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * Observability is a wave-2 architect — depends on Backend's
 * `apiEndpoints` + `errorEnvelope`. Precedence rank 9 per spec §5.2
 * (CANONICAL_PRECEDENCE_LADDER index 8) — operability sits below
 * safety/perf because it is a read-only concern.
 */
export const OBSERVABILITY_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['backend'],
  precedenceLevel: 9,
  fanoutPolicy: 'always',
  appliesPredicate: observabilityArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const ObservabilityArchitectContract: ArchitectSectionContract = {
  contractId: 'observability-architect.v1',
  architectName: 'observability',
  version: '0.1.0',
  sections: OBSERVABILITY_OWNED_SECTIONS,
  architectMeta: OBSERVABILITY_ARCHITECT_META
};
