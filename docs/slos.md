# Service Level Objectives (SLOs)

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §4.3 + §8.1.
> **Maintenance**: today this catalogue is operator-curated; Lantern Phase 1 (master sequencing item 16.5) consumes these as starting reference for burn-rate alerting.

This document codifies the initial six SLOs CAIA targets. SLOs are intentionally conservative for v0; revised after Lantern Phase 1 collects 4 weeks of baseline data.

## SLO format

Each SLO has:

- **Name** — what is being measured
- **SLI** — the indicator (the underlying measurement)
- **Target** — the numeric goal
- **Window** — the rolling window over which the target is evaluated
- **Burn-rate alert** — when an alert fires (Lantern Phase 1)
- **Owner** — who is responsible

## Initial six SLOs

### SLO-001 — Orchestrator API availability

- **SLI**: % of HTTP requests to orchestrator (`localhost:7776`) returning non-5xx response (excluding 429 / 503 deliberate pause states)
- **Target**: 99.9% over rolling 7 days
- **Window**: rolling 7d
- **Burn-rate alert**: 14.4× burn rate over 1h (corresponds to consuming 2% of error budget in 1 hour)
- **Owner**: Orchestrator team (Claude); Lantern surfaces

### SLO-002 — Executor task pickup latency

- **SLI**: time from task entering `tasks.queued` state to task entering `tasks.running` state
- **Target**: p95 < 10 seconds
- **Window**: rolling 7d
- **Burn-rate alert**: p95 > 30s sustained 10 minutes
- **Owner**: Executor team (Claude); Lantern surfaces

### SLO-003 — Dashboard render latency

- **SLI**: time-to-interactive (TTI) for dashboard pages at `localhost:7777`, measured client-side via Real User Monitoring or Lighthouse cron
- **Target**: p95 < 2 seconds
- **Window**: rolling 7d
- **Burn-rate alert**: p95 > 5s sustained 1h
- **Owner**: Frontend Architect Agent (when slotted, item 11.5); Lantern surfaces

### SLO-004 — Evidence Gate run time

- **SLI**: total wall-clock time from PR opened to all 6 required contexts green (or fail)
- **Target**: p95 < 5 minutes
- **Window**: rolling 7d
- **Burn-rate alert**: p95 > 10 minutes sustained 1d
- **Owner**: DevOps / Platform Architect Agent (when slotted, item 11.9); Steward surfaces today

### SLO-005 — MCP transport reliability

- **SLI**: % of MCP tool calls returning successfully (no transport error, no timeout)
- **Target**: p99 < 30s response time AND error rate < 1%
- **Window**: rolling 24h
- **Burn-rate alert**: error rate > 5% sustained 30 minutes; OR p99 > 60s sustained 30 minutes
- **Owner**: MCP allowlist proxy (`@chiefaia/mcp-allowlist-proxy`); Lantern surfaces

### SLO-006 — Spend-guard pause-state propagation

- **SLI**: time from spend-guard threshold breach event to all agents observing pause-state
- **Target**: < 1 second
- **Window**: every breach event (no rolling window — per-event)
- **Burn-rate alert**: any single propagation > 5 seconds; OR aggregate count of breaches > 3/week
- **Owner**: Spend Guard package (`@chiefaia/spend-guard`)

## Error budgets

For percentage-based SLOs, the error budget per rolling window is `(1 - target) × window`.

- SLO-001 (99.9% over 7d): 7d × 24h × 60min × 0.001 = ~10 min budget per 7d
- SLO-005 (99% reliability over 24h): 24h × 60min × 60s × 0.01 = ~864s of failed calls budget per 24h

Latency-based SLOs (SLO-002, 003, 004) are tracked as p95 thresholds; budget burn is tracked as % of measurements above threshold.

## Burn-rate alert pattern

Per Google SRE [Site Reliability Engineering] burn-rate alerting:

- **Fast burn**: 14.4× rate (consumes 2% of budget in 1h) → page operator
- **Slow burn**: 6× rate (consumes 5% of budget in 6h) → dashboard alert
- **Cumulative**: > 50% budget consumed in 7d → operator review

Lantern Phase 1 implements these via Prometheus AlertManager.

## SLO observability

Each SLO has a Grafana dashboard panel. Lantern Phase 1 also adds:

- Per-SLO error budget visualisation
- Burn-rate panel showing consumption velocity
- "Time-to-budget-exhaustion" projection

## What's NOT yet an SLO (deliberately)

- Per-agent cycle time (PO p95, BA p95, EA p95, etc.) — measured but not formal SLO until Lantern Phase 1 baselines
- Apprentice adapter eval win-rate — measured but not formal SLO until adapter is trained (item 6)
- End-to-end pipeline cycle time (prompt → merged) — measured but high variance; revisit at Lantern Phase 2
- Subscription-bucket utilisation — operational concern, not SLO

## Re-evaluation triggers

1. **Lantern Phase 1 baseline complete** (4 weeks of data) → re-tune all six SLO targets to be realistic relative to actuals.
2. **Productisation** — adds customer-facing SLOs (e.g., 99.9% per-tenant API availability, p95 < 200ms tenant API).
3. **New service shipped** → file new SLO if service is on critical path.

## See also

- [`runbooks/INDEX.md`](runbooks/INDEX.md) — runbook library scaffolding
- [`adr/ADR-011-evidence-gate.md`](adr/ADR-011-evidence-gate.md) — gate run time SLO source
- [`adr/ADR-010-four-layer-safety-stack.md`](adr/ADR-010-four-layer-safety-stack.md) — spend-guard
- `agent/memory/agent_ecosystem_expansion_directive.md` — Lantern slotting
- `~/Documents/projects/reports/lantern-agent-observability-research-2026-05-05.md` — Lantern foundational research
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §4.3 + §8.1 — full audit
