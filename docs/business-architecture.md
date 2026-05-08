# Business Architecture

> **Source**: distilled from `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.1.
> **Maintenance**: today Claude maintains; Atlas Agent (master sequencing item 13) takes over going forward.

## Mission

CAIA's mission is **to be the platform that builds and operates 100+ AI-driven niche websites + the Stolution startup, with zero human-in-loop coding**.

Three measurable end states:

- **Output 1**: 100 niche-traffic websites generating $10K–$50K/month each.
- **Output 2**: Stolution platform (~115GB DB + 80GB Meilisearch, 22-35M business listings; pre-launch) shipped to first paying users.
- **Output 3**: A self-improving substrate that compounds quality without operator coding — every new prompt benefits from accumulated learning.

The operator validates ONLY visual outputs (rendered websites, dashboards, UI behaviour). 100% of coding / CI/CD / DevOps / git is Claude's. This shape is inviolate; see `agent/memory/feedback_operator_does_not_code.md`.

## Stakeholders

| Stakeholder | Role | Today | At maturity |
|---|---|---|---|
| Operator (Prakash) | Principal PO, sole human stakeholder, validator-of-visuals | Drives intent via Cowork chat | Same; possibly investor relations + recruiting |
| Claude (Cowork) | Strategic orchestrator, planning, status updates | Operational | Same |
| Claude Code (subagent fleet) | Execution: coding, git, CI/CD, DevOps, infrastructure | Operational | Same |
| Tenant (productisation) | External user of CAIA-as-service | N/A | First tenant trigger reopens Option E decision |
| End users of niche sites | Visit pokerzeno.com, roulette.community, future sites | Consumers | Same; CAIA never exposes orchestration to them |
| Anthropic | LLM vendor; subscription provider | Vendor | Same; ToS surface tracked as risk |
| Apple / Mac hardware | Compute provider | Single-vendor for primary; Mac M1 Pro 16GB | Same; cloud GPU rental for occasional 14B+ training |

## Business capabilities

CAIA delivers seven categories of capability today (C1-C7) plus another twelve on the master sequencing roadmap (C8-C18) and four more held for productisation (C19-C22). The full list lives in [`capability-map.md`](capability-map.md). The summary:

- **C1. Prompt → deployed feature** — the Phase 1 + Phase 2 pipeline. From an operator prompt to a merged PR with passing tests + green Evidence Gate.
- **C2. Self-improvement loop** — Mentor (mistakes) + Curator (opportunities) + Librarian (knowledge) + Apprentice (adaptation) + pre-spawn injection.
- **C3. Safety + governance** — Evidence Gate, Steward Gatekeeper, Capability Broker, MCP Allowlist, Spend Guard.
- **C4. Knowledge + memory** — Markdown memory layer, ADR register, AKG, FREG, ACR.
- **C5. Observability + ops** — Langfuse, OpenTelemetry, Loki, Tempo, Grafana, Prometheus, Pulse, dashboard.
- **C6. Site operation** — pokerzeno.com, roulette.community, edisoncricket.com, prakash-tiwari.com, ankitatiwari.com, chiefaia.com.
- **C7. Stolution platform support** — Vault, Postgres, Meilisearch, Kafka via stolution-mcp.

## Value streams

The primary value stream is **prompt → spec → design → code → test → deploy → operate → improve**. The full mapping to Tier 2 (pipeline) and Tier 3 (self-improvement) agents lives in [`value-stream.md`](value-stream.md).

## KPIs

**Today's operational KPIs:**

- Pipeline cycle time (prompt → merged): p50, p95
- Sub-pipeline cycle time per stage (PO, BA, EA, Validator, Test-Design, Coding, Fix-It): p50, p95
- Subscription-bucket utilisation per feature: tokens consumed end-to-end
- Ollama-vs-Claude split: % of agent calls served by local Ollama (target: 60-70%)
- Evidence Gate pass rate: % of PRs that pass on first run
- Steward gate-trip rate per failure mode: how often each of 15 fires
- Mentor incident classification rate: incidents / time
- Worktree count: live count vs cap (≤8 alarm, ≤12 hard-block)
- Spend-guard pause events: count per week
- MCP timeout rate per hour: rolling 1h count vs 200/800 alarm thresholds
- Pulse health: 5 critical-rule pass rate

**At-maturity KPIs (productisation):**

- Per-tenant cycle time
- Per-tenant subscription-bucket utilisation
- Multi-tenant isolation incidents (target: 0)
- Compliance audit findings (target: 0 critical)
- Customer-facing SLO compliance (e.g., 99.9% API availability)
- Adapter quality vs base model on canonical eval: win-rate %
- Agent disagreement frequency (Mediator trigger)

The KPI dashboard surfaces in the Curator daily digest + Atlas capability map. Lantern Phase 1 adds burn-rate alerting.

## Standing decisions binding the business architecture

These are inviolate operator-authorised standing rules. Each has a memory file in `agent/memory/`. Brief summary:

- **Operator does NOT code** (`feedback_operator_does_not_code.md`).
- **Subscription-only LLM billing** — no API keys (ADR-007).
- **Mac-first inference** — Ollama bulk + claude binary synthesis (ADR-008).
- **Custom Hono runtime** — no LangChain / CrewAI / MS Agent Framework (ADR-009).
- **Option E agent shape** — private `@chiefaia/*` packages, parameterised + project-bonded (ADR-006).
- **Git Flow enforced** — feature → develop → main (ADR-015).
- **Single-threaded write per worktree** (ADR-013).
- **No token budgets on tasks** (`feedback_no_token_budgets.md`).
- **Self-perpetuating campaigns** — system never sits idle (`feedback_self_perpetuating_campaigns.md`).

## Re-evaluation triggers

The business architecture is re-evaluated when:

1. **Productisation trigger** — operator decides to multi-tenant CAIA AND signs ≥1 paying tenant or LOI within 90-day onboarding runway.
2. **Output-1 throughput trigger** — when 50+ niche sites are live (half of target), revisit the value stream for site-specific optimisations.
3. **Stolution launch** — at first paying user, revisit Stolution-specific value streams.

## See also

- [`capability-map.md`](capability-map.md) — operator-grade list of every capability
- [`value-stream.md`](value-stream.md) — prompt → improved-platform value stream
- [`adr/README.md`](adr/README.md) — load-bearing decisions register
- `agent/memory/MEMORY.md` — index of all standing rules and topic files
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` — comprehensive audit
