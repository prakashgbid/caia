# ADR-009 — Custom Hono runtime over LangChain/CrewAI/MS Agent Framework

## Status

**Accepted**. Re-evaluation trigger documented at end of file.

## Context

The agent-framework landscape (2025-2026) presents three families of runtime choices:

1. **Heavy frameworks** — LangChain, LangGraph, CrewAI, AutoGen, Microsoft Agent Framework. Pre-built abstractions for tools, memory, planners, multi-agent. High learning curve, high lock-in, opinionated.
2. **Code-as-graph** — LangGraph, Cognition Devin's internal patterns. Workflows expressed as state machines.
3. **Microservice + custom orchestration** — agents as Hono services, communication via HTTP + events. CAIA's existing pattern.

The 67-source meta-research (`~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md`) found that frontier teams (Anthropic, Cognition, Sourcegraph, Augment Code) all favour custom orchestration over heavy frameworks for these reasons:

- Heavy frameworks abstract away the agent decisions that matter (prompt management, tool selection, memory shape) — exactly what teams need to control.
- Lock-in costs compound: every CAIA-specific extension fights the framework's grain.
- Hono microservice pattern is the simplest possible runtime — no abstractions to fight, no version-churn risk.
- Single-threaded write per worktree (ADR-013) doesn't compose well with heavyweight in-process state machines.

The Enterprise AI Landscape directive (`enterprise_ai_landscape_directive.md`) explicitly steel-mans this stack and finds it "aged well" against industry trends.

## Decision

CAIA's runtime is custom-built on Hono microservices. Specifically:

- **Each agent** is a `@chiefaia/<agent>` package. Some run as Hono apps under `apps/<agent>/`; others spawn as ephemeral processes via `claude` binary subprocess.
- **Communication** is HTTP REST (sync) or Mentor's `ConductorEventBus` (async events).
- **Workflow** lives in TypeScript code, not in framework DSLs (no LangGraph state machines, no CrewAI roles).
- **Tools** are MCP servers — standard protocol, framework-agnostic.
- **Memory + knowledge** flow through Mentor + Librarian + sqlite-vec + AKG.
- **Eval** via Promptfoo (Wave 1).
- **Pre-spawn injection** is shaped explicitly as Mentor + Librarian prepend layers, NOT framework middleware.

Heavy frameworks are explicitly **rejected** for CAIA's first-party runtime:

- ❌ LangChain — too heavy, abstracts the wrong layer
- ❌ LangGraph — code-as-graph pattern doesn't match single-threaded-write-per-worktree shape
- ❌ CrewAI — role-based orchestration vs. CAIA's pipeline-stage orchestration
- ❌ Microsoft Agent Framework — corporate roadmap risk
- ❌ AutoGen — research-stage stability

Tactical OSS adoption stays open: Aider as Coding-Agent backend (validated 2026-05-06), Promptfoo for eval, Mem0 as Librarian backend, Claude Code subagents for sub-task delegation.

## Consequences

**Positive:**
- Zero framework lock-in — the whole runtime can be re-platformed without coupling to a single vendor's roadmap.
- Hono is minimal — each agent is a small file with explicit routes.
- Composes cleanly with single-threaded-write-per-worktree, Evidence Gate, Steward Gatekeeper.
- Hires (if eventual) onboard via CAIA's own conventions, not framework-specific lore.

**Negative:**
- More code to write per agent (no pre-built abstractions). Mitigated by `@chiefaia/runtime-helpers` shared utilities and Option E parameterised shape (ADR-006).
- No "drop in this framework, get a multi-agent demo" path — every capability is built explicitly.
- Some heavy-framework patterns (e.g., LangGraph's graphical workflow viewer) are absent. Choreographer Phase 5 will provide a comparable EventCatalog dashboard.

**Neutral:**
- Tactical OSS adoption decisions are independent — Aider, Promptfoo, Mem0 are tools, not frameworks.

## Re-evaluation triggers

1. **Industry consolidation** — if the broader ecosystem consolidates onto one framework (e.g., Microsoft Agent Framework reaches market dominance), re-evaluate consuming it for new agent classes only.
2. **Productisation** — multi-tenant onboarding may require off-the-shelf runtime abstractions for tenant-defined agents. Re-evaluate at first paying tenant.
3. **Custom runtime maintenance burden exceeds bench** — if maintaining the custom runtime exceeds 25% of total agent-build effort over a sustained 8-week window, re-evaluate.

## References

- Decision report: `~/Documents/projects/reports/agent-architecture-strategic-decision-2026-05-06.md`
- Landscape directive: `agent/memory/enterprise_ai_landscape_directive.md`
- Audit reference: `caia-enterprise-architecture-comprehensive-2026-05-06.md` §3.4 + §10.2.6
- Companion ADRs: ADR-006 (Option E shape), ADR-013 (single-threaded write per worktree)
