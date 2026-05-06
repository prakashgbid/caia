# Capability Map

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.1.3 + §6.
> **Maintenance**: today Claude maintains; Atlas Agent (master sequencing item 13) takes over going forward — auto-detects new capabilities from PR merge events.

This is the operator-grade list of every CAIA capability, who consumes it, and what state it is in. Read this as the answer to "what can CAIA do today, what's coming, what's deferred to productisation?"

## Status legend

- ✅ **Live** — shipped, evidenced by merged code in CAIA monorepo
- 🔄 **In flight** — active campaign, partially shipped
- 📋 **Backlog** — filed directive, master sequencing slot assigned
- ⏸ **Deferred** — explicit re-evaluation trigger documented

## C1 — Prompt → deployed feature pipeline

| ID | Capability | Consumer | Status | Implementing surface |
|---|---|---|---|---|
| C1.1 | Prompt ingestion | Operator (Cowork chat) | ✅ Live | `apps/scaffolder` |
| C1.2 | Decomposition (PO Agent + recursive decomposer) | Pipeline | ✅ Live | `@chiefaia/po-agent`, `@chiefaia/decomposer-recursive` |
| C1.3 | Story enrichment (BA Agent + cross-agent collab) | Pipeline | ✅ Live | `@chiefaia/ba-agent` |
| C1.4 | Architectural instructions (EA Agent + AKG) | Pipeline | ✅ Live | `@chiefaia/ea-agent`, `@chiefaia/architecture-registry` |
| C1.5 | Story validation (composed-template rubric) | Pipeline | ✅ Live | `@chiefaia/story-validator`, `@chiefaia/agent-contract-registry` |
| C1.6 | Test design (test_cases generation) | Pipeline | ✅ Live | `@chiefaia/test-design-agent` |
| C1.7 | Multi-bucket scheduling (ready-pool + claims) | Pipeline | ✅ Live | `@chiefaia/task-manager` |
| C1.8 | Code generation (Coding Agent) | Pipeline | ✅ Live | `@chiefaia/coding-agent` (claude binary spawn); Aider pilot 🔄 |
| C1.9 | Test execution (Fix-It Test Agent, max 6 retries) | Pipeline | ✅ Live | `@chiefaia/fix-it-test-agent` |
| C1.10 | Evidence-gated PR merge | Pipeline | ✅ Live | `.github/workflows/evidence-gate.yml` (ADR-011) |
| C1.11 | Release (develop → main) | Pipeline | ✅ Live | weekly release/* PR (ADR-015) |

## C2 — Self-improvement loop

| ID | Capability | Consumer | Status | Implementing surface |
|---|---|---|---|---|
| C2.1 | Mistake-driven learning (Mentor) | All agents (pre-spawn) | ✅ Live (Phase 0+) | `@chiefaia/mentor` |
| C2.2 | Opportunity-driven learning (Curator) | Operator daily digest | ✅ Live (Phase 1+) | `@chiefaia/curator` |
| C2.3 | Knowledge graph + retrieval (Librarian) | All agents (pre-spawn) | ✅ Live (Phase 1) | `@chiefaia/librarian` (Mem0 swap pending — Wave 2) |
| C2.4 | Aggregate-pattern learning (Apprentice; LoRA) | Future Ollama serving | 🔄 Phase 0 | `apps/apprentice/*`, `packages/apprentice-corpus`, ... |
| C2.5 | Pre-spawn lesson injection | All agents | ✅ Live | Mentor + Librarian prepend pipelines |

## C3 — Safety + governance

| ID | Capability | Consumer | Status | Implementing surface |
|---|---|---|---|---|
| C3.1 | Pre-merge gate (6 required contexts) | Every PR | ✅ Live | Evidence Gate (ADR-011) |
| C3.2 | Continuous gatekeeper (15 failure modes) | Daily/weekly + pre-spawn | ✅ Live | Steward Gatekeeper (ADR-012) |
| C3.3 | Capability-based action authorisation | Every irreversible action | ✅ Live | `@chiefaia/capability-broker` (ADR-010) |
| C3.4 | MCP supply-chain hardening (allowlist + sanitizer) | Every MCP call | ✅ Live | `@chiefaia/mcp-allowlist-proxy` + `@chiefaia/tool-output-sanitizer` (ADR-010) |
| C3.5 | Spend cap enforcement | Every LLM invocation | ✅ Live | `@chiefaia/spend-guard` (ADR-007 + ADR-010) |

## C4 — Knowledge + memory

| ID | Capability | Consumer | Status | Implementing surface |
|---|---|---|---|---|
| C4.1 | Markdown memory layer (47+ files + index) | All agents (pre-spawn) | ✅ Live | `agent/memory/MEMORY.md` + topic files |
| C4.2 | ADR register | Architecture review | ✅ Live | `caia/docs/adr/` (10 inherited + ADR-006..015) |
| C4.3 | Architecture Knowledge Graph (AKG) | EA Agent at story stage | ✅ Live | `arch_*` Postgres tables + sqlite-vec |
| C4.4 | Feature Registry (FREG) | PO Agent | ✅ Live | `feature_registry*` tables + sqlite-vec |
| C4.5 | Agent Contract Registry (ACR) | Validator | ✅ Live | `@chiefaia/agent-contract-registry` |

## C5 — Observability + ops

| ID | Capability | Consumer | Status | Implementing surface |
|---|---|---|---|---|
| C5.1 | LLM trace observability | Operator + Curator | ✅ Live | Langfuse self-hosted on stolution |
| C5.2 | Distributed tracing | Operator | ✅ Live | OpenTelemetry → Tempo |
| C5.3 | Log aggregation | Operator + Curator | ✅ Live | Loki + Promtail |
| C5.4 | Metrics | Operator dashboard | ✅ Live | Prometheus + `/prom-metrics` (8 named metrics) |
| C5.5 | Dashboards | Operator | ✅ Live | Grafana on stolution + CAIA dashboard at :7777 |
| C5.6 | Health/Pulse (3-layer canary) | Operator | ✅ Live | `/observability/health` + `/health/pulse` |

## C6 — Site operation

| ID | Site | Status |
|---|---|---|
| C6.1 | pokerzeno.com | ✅ Live |
| C6.2 | roulette.community | ✅ Live |
| C6.3 | edisoncricket.com | ✅ Live |
| C6.4 | prakash-tiwari.com | ✅ Live |
| C6.5 | ankitatiwari.com | 🔄 In progress |
| C6.6 | chiefaia.com | ⏸ Domain bought, not live (CAIA productisation gating) |

## C7 — Stolution platform support

| ID | Capability | Status |
|---|---|---|
| C7.1 | Vault, Postgres, Meilisearch, Kafka via stolution-mcp | ✅ Live |

## C8-C18 — Capabilities planned (master sequencing items 2-16)

| ID | Capability | Slot | Status |
|---|---|---|---|
| C8 | Choreographer-managed event-driven architecture across projects | Item 14 | 📋 Backlog (12-17 wks) |
| C9 | Apprentice-trained CAIA-bonded LoRA adapter | Item 6 + 8 | 🔄 Phase 0 |
| C10 | Strategist-driven roadmap + priority-stack ranking | Item 12 | 📋 Backlog |
| C11 | Critic-driven adversarial pre-merge review | Item 9 | 📋 Backlog |
| C12 | Surface-driven operator-perspective continuous review | Item 11 | 📋 Backlog |
| C13 | Researcher-driven on-demand deep-dive evals | Item 10 | 📋 Backlog |
| C14 | Forecaster ETA + risk projection | Item 12.x | 📋 Backlog |
| C15 | Reporter outbound communication synthesis | Item 12.x | 📋 Backlog |
| C16 | Atlas live capability cartography | Item 13 | 📋 Backlog |
| C17 | Reliability/SRE chaos testing + recovery validation | Item 16 | 📋 Backlog |
| C18 | Lantern observability completeness + SLO + alerting + runbook | Item 16.5 | 📋 Backlog (8-12 wks) |

## C19-C22 — Capabilities planned for productisation (deferred to first paying tenant)

| ID | Capability | Trigger |
|---|---|---|
| C19 | Multi-tenant orchestration (Tenant Onboarder, Billing, Compliance) | First paying tenant |
| C20 | Customer-facing API surface (API Architect, public versioning) | First paying tenant |
| C21 | UI for tenant operators (UX Architect, design system) | First paying tenant |
| C22 | Identity + authorization (per-tenant capability isolation) | First paying tenant |

## Architect agent capabilities (master sequencing items 11.5-11.10, 8.5, 13.5, 14.5, 14.6)

These are domain-specialist architect agents recommended in the audit §6.3, all inheriting Option E shape (ADR-006).

| Architect agent | Domain | Slot | Status |
|---|---|---|---|
| Frontend Architect | React 19 / Tailwind / accessibility / bundle-size / WCAG | 11.5 | 📋 Backlog |
| Backend Architect | Hono / Drizzle / Postgres / event bus / API design | 11.6 | 📋 Backlog |
| Database Architect | Drizzle / migrations / index strategy / sharding / vector | 11.7 | 📋 Backlog |
| Security Architect | Threat modelling / OWASP LLM Top 10 / SLSA / SBOM | 11.8 | 📋 Backlog |
| DevOps / Platform Architect | LaunchAgents / cron / GH Actions / branch protection | 11.9 | 📋 Backlog |
| Performance Architect | Profiling / load test / cache / index strategy | 11.10 | 📋 Backlog |
| AI/ML Architect | Model selection / routing / prompt mgmt / eval | 8.5 | 📋 Backlog |
| Docs Architect | ADR governance / docs structure / onboarding | 13.5 | 📋 Backlog |
| Integration Architect | Outbound integrations / webhook / Pact contract test | 14.5 | 📋 Backlog |
| Data Architect | MDM / data lifecycle / lineage | 14.6 | 📋 Backlog |
| API Architect | Public API versioning / OpenAPI / rate limiting | 18.5 | ⏸ Productisation |
| UX Architect | Design system / a11y / i18n / RTL | 18.6 | ⏸ Productisation |

## See also

- [`business-architecture.md`](business-architecture.md) — mission, stakeholders, KPIs
- [`value-stream.md`](value-stream.md) — primary value stream
- [`adr/README.md`](adr/README.md) — load-bearing decisions register
- `agent/memory/master_backlog_sequencing_2026-05-05.md` — sequencing of items 2-20
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.1.3 + §6 — full audit
