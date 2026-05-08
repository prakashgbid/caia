# Data Ownership

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.2.4 + §7.3.
> **Maintenance**: today Claude maintains; Atlas Agent (master sequencing item 13) auto-detects new data domains going forward.

This document is the master data management (MDM) matrix — for every CAIA data domain, who is the owner-of-record, who reads it, who has write authority. The pattern: every data domain has a single source of truth; reads fan out; writes are gated through the owner.

## Ownership matrix

| Data domain | Owner-of-record | Read consumers | Write authority |
|---|---|---|---|
| Operator profile | `agent/memory/user_profile.md` | All agents (pre-spawn) | Operator only |
| Project state (CAIA) | `agent/memory/project_caia.md` + Postgres `projects` table | All agents | Steward + orchestrator |
| Project state (Stolution) | `agent/memory/project_stolution.md` | All agents | Operator + stolution-mcp |
| Site state (pokerzeno, roulette, etc.) | `agent/memory/mac_dev_landscape.md` | All agents | Curator (auto-update on hygiene sweep) |
| Pipeline state | Postgres tables | Dashboard, executor, agents | Orchestrator (PumpEngine) |
| Agent state | Postgres `agent_registry` + per-agent tables | Pipeline | Agent itself |
| Run state | Postgres `task_runs` | Executor, dashboard | Executor |
| Observability state | Langfuse + Loki + Tempo + Prometheus | Operator + Lantern (future) | Auto-emitted |
| Mentor incidents | sqlite `_mentor-index.sqlite` | All agents (pre-spawn) | Mentor agent |
| Librarian knowledge | sqlite + Mem0 (future) | All agents (pre-spawn) | Librarian agent |
| Curator opportunities | Filesystem digests | Operator | Curator agent |
| AKG | Postgres `arch_*` tables + sqlite-vec | EA Agent + Validator | ts-morph extractor on PR merge |
| FREG | Postgres `feature_registry*` tables + sqlite-vec | PO Agent | FeatureRegistryWriter on `story.completed` |
| ACR | Postgres + agent contract files | Validator | Agents themselves (declare contracts) |
| Vault secrets | Vault server (stolution) | Agents via AppRole login | Operator + stolution-rotate policy |
| Backups | Filesystem (off-server rsync) | Restore-drill scripts | Cron jobs |

## Data tiers (per §7.3)

| Tier | Purpose | Tech |
|---|---|---|
| Relational core | Pipeline state, registries, audit | Postgres + Drizzle ORM |
| Vector indices | Semantic retrieval | sqlite-vec + nomic-embed-text via Ollama |
| Knowledge graph | Architectural artifact relationships | Postgres `arch_*` tables; future NetworkX in-process |
| Filesystem | Memory MD, reports, training corpora, model adapters | Mac filesystem; quarterly off-server backup |
| Secrets | API keys, OAuth tokens, AppRole creds | HashiCorp Vault on stolution |
| Hot caches | LLM responses, frequently retrieved | `@chiefaia/cache` + `@chiefaia/llm-cache` |
| Logs / traces / metrics | Telemetry | Loki + Tempo + Prometheus on stolution |
| Backup | Periodic snapshots | Vault daily + DB hourly + Memory weekly + worktree pre-destructive-op |

## Ownership rules

1. **One owner per domain.** No domain has shared write authority; the listed write authority is the only path that may mutate the domain.
2. **Reads fan out freely.** Any agent may read any non-Secret-class domain. Secret-class reads go through Vault AppRole login (per ADR-014).
3. **Writes go through the owner's API.** No direct table writes that bypass the owner's API surface (e.g., other agents do NOT write to `arch_*` tables — they raise PRs whose merge events trigger ts-morph extraction).
4. **Audit-logged writes.** Every irreversible action lands in `irreversible_actions` (capability ledger) and `audit_log` (per ADR-010). Bounded-growth check is Steward failure mode #8.
5. **Backups are tier-bounded.** Vault snapshots 30d, DB backups rolling, telemetry per Lantern config, training corpus 90d, model adapters until replaced.

## Cross-domain dependencies

- **Pipeline state ↔ FREG**: pipeline emits `story.completed` → FREG writer indexes → PO Agent retrieves on next prompt.
- **Pipeline state ↔ ACR**: agents declare contracts → ACR composes template → Validator gates story validation.
- **Pipeline state ↔ AKG**: PR merge → ts-morph extracts → AKG entities + edges → EA Agent retrieves on next architecture stage.
- **Mentor incidents → All agents**: pre-spawn injection retrieves nearest-neighbour lessons.
- **Librarian knowledge → All agents**: pre-spawn injection retrieves nearest-neighbour precedent.
- **Apprentice corpus → Adapter**: corpus distilled → LoRA training → eval → swap in Ollama serving.

## Data ownership at productisation (deferred)

- **Per-tenant pipeline state**: Tenant Onboarder + per-tenant DB schema namespace; tenant write authority is the tenant-scoped agent only.
- **Per-tenant secrets**: Vault per-tenant namespace; tenant has no read access to other tenants' Vault paths.
- **Multi-tenant isolation incidents**: target zero; surface in operator dashboard.

## Re-evaluation triggers

1. **New data domain emerges** — Atlas Agent auto-detects on PR merge; matrix updates.
2. **Productisation** — multi-tenant adds per-tenant ownership scoping.
3. **Compliance audit** — adds data lineage + ROPA columns.

## See also

- [`information-classification.md`](information-classification.md) — public / internal / secret / regulated
- [`adr/ADR-014-hashicorp-vault.md`](adr/ADR-014-hashicorp-vault.md) — Vault as Secret-class canonical store
- [`adr/ADR-010-four-layer-safety-stack.md`](adr/ADR-010-four-layer-safety-stack.md) — capability ledger + audit log
- [`capability-map.md`](capability-map.md) — every capability and which domain it consumes
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.2.4 + §7.3 — full audit
