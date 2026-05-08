# Communication Architecture

> **Source**: distilled from `caia-enterprise-architecture-comprehensive-2026-05-06.md` §7.1.
> **Maintenance**: today Claude maintains; Backend Architect Agent (master sequencing item 11.6) takes over going forward.

This document codifies CAIA's communication kinds, when to use what, and what's explicitly NOT done today (deferred to productisation).

## Communication kinds (when to use what)

| Kind | When to use | Today's mechanism | Future direction |
|---|---|---|---|
| **Synchronous request/response** | Operator-initiated; short tasks; retrieval; control plane | Hono REST at orchestrator :7776 | Same; add OpenAPI spec coverage at productisation |
| **RPC (inter-service, sync)** | Cross-service calls within trust boundary | Currently NONE explicit; service-to-service via HTTP | Defer formal RPC; revisit at productisation |
| **Asynchronous events** | State changes; multi-consumer broadcasts; durable | `ConductorEventBus` (Mentor's substrate); future Choreographer-extended | Choreographer formalises; CloudEvents v1.0.2 envelope; AsyncAPI 3.0 spec |
| **Real-time push (UI)** | Dashboard reflecting live state | WebSocket `ws://localhost:7776/events` | Per-client filter expressions (Choreographer Phase 1) |
| **External (LLM integration)** | claude binary subprocess; MCP servers | MCP stdio transport; allowlisted spawn | Same; A2A (Google) when AAIF GA |
| **Cross-host (Mac ↔ stolution)** | Vault reads, Postgres queries, observability scrape | SSH alias + stolution-mcp | Same; future Tailscale if needed |
| **Cron / scheduled** | Periodic checks (daily Steward, hourly heartbeat) | LaunchAgents (Mac), cron (stolution), scheduled-tasks MCP | Same |

## Decision matrix

```
Is this a state change that multiple consumers might care about?
  YES → Async event (Mentor topic if incident.*; Choreographer topic if application.*)
  NO  ↓

Is this an operator-initiated request that needs an immediate response?
  YES → Sync REST endpoint
  NO  ↓

Is this a cross-service call within a single tier (e.g., orchestrator → executor)?
  YES → HTTP REST (today); evaluate RPC at productisation
  NO  ↓

Is this a UI live-update?
  YES → WebSocket broadcast (today fans out everything; Choreographer adds filtering)
  NO  ↓

Is this an LLM integration?
  YES → claude binary subprocess OR Ollama HTTP
  NO  ↓

Is this a 3rd-party integration (Vault, GitHub, Cloudflare)?
  YES → Use the dedicated MCP tool (stolution-remote, github-mcp, etc.)
  NO  ↓

Is this a periodic check?
  YES → LaunchAgent (Mac) OR cron (stolution) OR scheduled-tasks MCP
  NO  → Reconsider; missing pattern
```

## Two-bus event model

CAIA has two complementary event buses (see Choreographer directive `agent/memory/choreographer_agent_directive.md`):

| Bus | Purpose | Topics | Backend | Cross-host? |
|---|---|---|---|---|
| **Mentor's `ConductorEventBus`** | Incident / mistake / decision events | `task.*`, `operator.*`, `incident.*`, `decision.*` | SQLite + Node EventEmitter + WebSocket | No (Mac-local) |
| **Choreographer's** (planned) | General application domain events | `<project>.<context>.<event>` (e.g., `caia.requirements.refined`, `pokerzeno.user.signed-up`) | SQLite (small) + Kafka (durable + cross-host) + CloudEvents envelope | Yes |

Choreographer **builds on** Mentor's substrate. Same `emit()` SDK shape; topics route to different backends based on namespace.

## Event schema standards

- **Wire envelope**: CloudEvents v1.0.2 (CNCF graduated). Reference SDK: `cloudevents-node`. Bindings for HTTP / Kafka / AMQP / MQTT / NATS / WebSocket.
- **Schema-of-record format**: AsyncAPI 3.0. Tooling: `@asyncapi/parser`, `@asyncapi/generator`, `@asyncapi/cli`, `@asyncapi/react-component`.
- **Schema registry**: in-repo AsyncAPI files + CI gate for v1 (single-tenant); Apicurio Registry self-hosted for v2 (multi-tenant).

## Event versioning strategy

- **Backward-compatible schema changes** (`BACKWARD_TRANSITIVE`) are the default; non-breaking changes flow through CI gate.
- **Breaking changes** require a `v2` topic spawned alongside `v1`; consumers migrate; `v1` deprecated then removed.
- **No silent schema drift** — CI verifies code emits/subscribes match the spec; drift blocks merge.

## What's explicitly NOT today

| Pattern | Rationale | Re-evaluation trigger |
|---|---|---|
| Service mesh (Istio / Linkerd / Consul Connect) | Overkill at ~15 services on a single Mac + a few stolution daemons | Productisation + multi-host scale |
| Formal API gateway / federation | Internal-only services; one consumer (operator) | Productisation |
| Tailscale / private network | SSH alias suffices for current Mac↔stolution traffic | Multi-host beyond 2 |
| Full event sourcing (rebuild state by replay) | Too heavy for current scale | Productisation + replay-driven recovery requirements |
| RPC (gRPC / tRPC) | HTTP REST with schemas suffices | Productisation + cross-language services |

## A2A protocol

The Google A2A (Agent-to-Agent) protocol is on the AAIF roadmap. Scheduled task fires 2026-07-01 to re-check GA status. Until then, CAIA agents communicate via Hono REST + ConductorEventBus.

## Operational policies

- **WebSocket fanout**: today every subscriber receives every event in a topic; per-client filtering arrives in Choreographer Phase 1.
- **MCP transport**: stdio only (per ADR-010 allowlist proxy); HTTP MCP transport is not enabled.
- **Subprocess spawn allowlist** (per ADR-010): `{npx, uvx, python, python3, node, docker, deno}`.
- **0.0.0.0 / [::] binds**: rejected at allowlist proxy.
- **localhost loopback**: orchestrator + dashboard bind 127.0.0.1 only.

## See also

- [`adr/ADR-009-custom-hono-runtime.md`](adr/ADR-009-custom-hono-runtime.md) — runtime decision
- [`adr/ADR-010-four-layer-safety-stack.md`](adr/ADR-010-four-layer-safety-stack.md) — MCP allowlist + sanitizer
- `agent/memory/choreographer_agent_directive.md` — formal EDA establishment + brownfield migration
- `~/Documents/projects/reports/choreographer-agent-eda-research-2026-05-05.md` — 50+-source EDA research
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §7.1 + §7.2 — full audit
