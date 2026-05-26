# Plan: @chiefaia/tracing 0.3.0 — OTel spine + Tempo deploy

**Plan type:** implementation
**Caller agent:** `@chiefaia/tracing` (this package)
**Submitted by:** Stolution
**Affected components:**
  `@chiefaia/tracing`,
  `@chiefaia/claude-spawner`,
  `@caia/state-machine`,
  `@chiefaia/event-bus-nats`,
  `@caia/ea-architect`,
  `@caia/lifecycle-conductor`,
  `@chiefaia/chain-runner`,
  `infra/tempo/`
**Spec:** gap analysis G47 + W5 (P1 — Phase 6 distributed tracing spine)
**Branch:** `feature/otel-tracing-tempo-2026-05-25`
**ADRs touched:** none new; aligns with ADR-065 (reuse-first)

## Goal

When a customer kicks off a wizard step (or an agent dispatches a
sub-task), a single `trace_id` should propagate through every spine
package call + every event on the NATS bus + every Postgres query,
so the operator can `curl http://tempo.chiefaia.svc.cluster.local:3200/api/traces/<id>`
and see the full call graph end-to-end.

V1 scope per operator decision dated 2026-05-25:

- **Code:** extend the existing `@chiefaia/tracing` package
  (canonical reuse target) — no parallel `@chiefaia/otel`.
- **Infra:** Tempo only (no Grafana — deferred).
- **Verification:** Tempo HTTP query API (`/api/traces/<id>`); Grafana
  comes in a follow-up PR.

## Scope (V1 — this PR)

1. **`@chiefaia/tracing` 0.2.0 → 0.3.0** — extends the existing
   manual tracer surface with:
   - `initTracing(opts)` — NodeSDK bootstrap, OTLP-HTTP exporter
     pointed at `http://tempo.chiefaia.svc.cluster.local:4318` by
     default, W3C TraceContext + Baggage propagators, auto-
     instrumentations for `pg` / `http` / `undici` (the engine
     backing global `fetch`).
   - `shutdownTracing()`, `isTracingInitialised()`, `currentServiceName()`.
   - `injectContext(carrier, spanCtx?)` / `extractContext(carrier)` —
     W3C-spec wire format.
   - `withNatsPublishSpan(opts, fn)` / `withNatsConsumeSpan(opts, fn)` —
     manual NATS span helpers (no first-party
     `@opentelemetry/instrumentation-nats` exists for `nats@2`).
   - `parseTraceparent`, `spanCtxToOtelContext` (convenience).
   - 23 vitest cases (vs. v0.2.0's 4) covering tracer, init, propagation,
     NATS helpers, and an SDK-level integration round-trip via
     `InMemorySpanExporter`.
2. **Spine wiring** — 6 packages add `@chiefaia/tracing` as a
   workspace dep and wrap their primary entry-point with a span:
   - `@chiefaia/claude-spawner.spawnClaude` -> `claude.spawn`
   - `@caia/state-machine.transition` -> `caia.state-machine.transition`
   - `@chiefaia/event-bus-nats.publish` / consume -> `nats.publish` /
     `nats.consume` (with W3C TraceContext injected into the
     `EventEnvelope.trace` field — additive, schema_version unchanged)
   - `@caia/ea-architect.submitPlan` -> `caia.ea.submit-plan`
   - `@caia/lifecycle-conductor.LifecycleAggregator.ingest` ->
     `caia.lifecycle.ingest`
   - `@chiefaia/chain-runner.dispatchPhase` -> `chain-runner.dispatch-phase`
     (root span for every dispatched task)
   Edits are surgical: each wrapped function gets a `_<name>Impl`
   private/internal alias; the original body is untouched.
3. **Tempo manifests** at `infra/tempo/`:
   - `10-configmap.yaml` — monolithic mode, OTLP HTTP+gRPC receivers,
     local storage, 7-day retention.
   - `20-service.yaml` — ClusterIP only, ports 3200/4317/4318/9095.
   - `30-deployment.yaml` — single replica, `grafana/tempo:2.6.0`,
     emptyDir storage (5Gi), non-root, read-only rootfs, dropped caps.
   - `README.md` — apply + verify (kubectl-run curl probe against
     `/api/traces/<id>`).
4. **Placeholder dashboard** at `infra/grafana/dashboards/caia-traces.json`
   — marker file noting Grafana is deferred and listing the intended
   panels for the follow-up PR.

## Scope (deferred — follow-up PRs)

- **Grafana itself.** Per the operator decision, Grafana is deferred
  to avoid adding a second new in-cluster pod beyond Tempo. The
  placeholder dashboard JSON ships now so the follow-up PR can drop
  in panels without churning paths. The README in `infra/tempo/`
  documents the helm install command for when this lands.
- **Sampling tuning.** V1 is `samplingRatio: 1.0` (everything).
  Drop to 0.1 once Tempo ingester memory or local-disk usage stays
  above 70% for a week.
- **Tempo storage upgrade.** V1 uses emptyDir for $0 setup. Promote
  to PVC + object storage (Wasabi / R2) when retention SLAs land.
- **Per-package custom-span coverage.** V1 wraps the spine entry
  points only. Inner spans for hot loops (e.g. per-FSM-step inside
  `transition`, per-event inside the conductor's aggregator loop)
  can land package-by-package once the spine is proven.
- **Trace-based metrics.** Tempo's `metrics_generator` is configured
  but no consumer is wired yet — Grafana follow-up.

## State-machine integration

Not applicable for this PR — `@chiefaia/tracing` is a cross-cutting
observability concern, not a workflow node. It does not own any FSM
transitions in `@caia/state-machine`. (It does instrument the
existing `transition()` method.)

## Risk and rollback

- **Dependency surface grows.** 8 new `@opentelemetry/*` deps land in
  `@chiefaia/tracing`. All are pinned at versions already present in
  the workspace lockfile transitively (audited via `pnpm-lock.yaml`).
- **Wire-format change to EventEnvelope.** The `trace` field is
  optional and additive; older producers (no field) still parse via
  the existing `decodeEnvelope` validator; older consumers ignore the
  field. No schema_version bump needed.
- **No-op safety.** Every wrapped function delegates to the existing
  body via a tracer that degrades to no-op spans when `initTracing()`
  has not been called. Tests that don't bootstrap the SDK are
  unaffected.
- **Rollback** is `git revert` of the merge commit + `kubectl delete -f infra/tempo/`.
  No data migrations.

## Reuse search (per ADR-065)

See the `reuseSearchResults` array in `scripts/submit-plan.mjs`.
Canonical reuse target identified: `@chiefaia/tracing` itself
(v0.2.0 already shipped `createTracer/startSpan/withSpan`). The
operator decision dated 2026-05-25 explicitly forbids a parallel
`@chiefaia/otel` — this PR extends `@chiefaia/tracing` in place.

## Tests

`packages/tracing/tests/`:

- `tracer.test.ts` — 6 cases (5 new + 1 preserved expanded)
- `init.test.ts` — 6 cases (init idempotency, service name, lifecycle,
  default endpoint, custom endpoint, shutdown safety)
- `propagation.test.ts` — 8 cases (parseTraceparent valid + invalid,
  inject with explicit spanCtx, inject no-op, round-trip extract,
  extract with no header, extract with malformed header)
- `nats-instrumentation.test.ts` — 5 cases (publish returns + injects
  + rethrows, consume passes parent + handles null)
- `integration.test.ts` — 4 cases backed by `InMemorySpanExporter`
  (round-trip span capture, OK status, ERROR status, propagation
  round-trip)

Total: **23 cases**, >= 20 target.

## Acceptance

- `pnpm --filter @chiefaia/tracing test` green
- `pnpm --filter @chiefaia/tracing typecheck` green
- Each spine package's existing test suite remains green (span wrappers
  are pass-through when SDK isn't initialised)
- `kubectl -n chiefaia apply -f infra/tempo/` succeeds; pod becomes
  Ready within 60 s
- `curl /api/traces/<id>` against the in-cluster Tempo returns a JSON
  body for a fired synthetic trace within 15 s of the publish call

## True-Zero / admin-merge

Authorised by PR #587 + `.caia/build-phase-active` marker. Self-merge
ritual: `gh api DELETE enforce_admins` -> `gh pr merge --admin --squash
--delete-branch --subject "...[True-Zero admin-merge]"` ->
`gh api POST enforce_admins`.
