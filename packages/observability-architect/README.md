# @caia/observability-architect

Architect #9 of CAIA's 17-architect EA fan-out. Senior SRE / observability engineer focused on **logs, metrics, traces, and alerts**.

## What it owns

`observability.*` slice of the `tickets.architecture` JSONB column:

- `observability.loggingStrategy` — structured-log contract (shape, per-endpoint levels, routing). Mirrors `@chiefaia/logger`.
- `observability.errorTrackingProvider` — Sentry default; customer-override for Rollbar / Datadog / "none". Fingerprint keyed by `errorEnvelope.code`.
- `observability.tracingStrategy` — OpenTelemetry. Span naming, semantic conventions, sampling (tail 100% on 5xx, head 10% on success). Mirrors `@chiefaia/tracing`.
- `observability.metricsEmitted` — Prometheus-compatible metric names. Mirrors `@chiefaia/metrics`.
- `observability.slis` — Service Level Indicators derived from `metricsEmitted` (availability, latency_p95, error_rate).
- `observability.slos` — Service Level Objectives. Always declared. 99.5% availability / 30d default; p95 < 500ms reads / < 1000ms writes / 7d default.
- `observability.alertingRules` — Severity ladder: P0 page in 5min / P1 ticket in 60min / P2 advisory.
- `observability.dashboardSpec` — Grafana iframe panels per route (request rate, latency quantiles, error rate, SLO burn).
- `observability.runbookReferences` — Per-alert recovery steps; one entry per alerting rule id.

## What it does NOT do

**No component code.** Frontend Architect writes JSX. **No backend logic.** Backend Architect writes route handlers. **No database schema.** Database Architect owns that. This architect specifies what gets logged, what metrics are emitted, what alerts fire, what dashboards render. Out-of-namespace writes are rejected.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1 + §2.9). **Wave 2** — depends on Backend Architect's `apiEndpoints` + `errorEnvelope` + `rateLimits` to know which routes to instrument. Sonnet by default. Tools empty for V1.

## Quick start

```ts
import { ObservabilityArchitect, ObservabilityArchitectContract } from '@caia/observability-architect';

const architect = new ObservabilityArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { backend: backendOutput } }, // REQUIRED for observability
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests including golden SLI/SLO check)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, dependency declaration (`depends on backend`), cross-architect invariants, and an end-to-end golden test that locks realistic SLI/SLO definitions for a known prakash-tiwari Widget ticket.

## Notes

- Architect name is `"observability"`. The owned-field namespace is `observability.*` (matches the architect name; no alias).
- Precedence rank **9** — operability sits below safety (Security #1, DevOps #2), legal exposure (A11y #3, SEO #4), and performance (#5) because it is a read-only concern. Above analytics (#10), database (#11), backend (#12), aiml (#13), frontend (#14), and the operator-facing critics.
- V1 ships with **zero tools**. The architect reads upstream Backend's endpoint inventory + error envelope and emits log/metric/trace/alert specs. A future `caia-prom-validator` MCP will let the architect lint metric names against Prometheus conventions at synthesis time.
