# `@caia/info-architect`

> **Information Architect (IA) Agent — Step 3.5 in CAIA's canonical pipeline**

Ratified 2026-05-25 in ADR-024. Sits between the Interviewer (Step 3, emits `BusinessPlanV2`) and the Proposal + Design-App Prompt Generator (Step 4, henceforth consumes IA artifacts instead of inventing them).

This is the **first pipeline step that emits structural truth** — every downstream step reads its outputs as the canonical contract for *"what is this site, made of what, structured how."*

## Surface

```ts
import { runInformationArchitecture, InfoArchitectAgent } from '@caia/info-architect';
```

The package exposes:

- `runInformationArchitecture(projectId, deps)` — orchestrator that drives the canonical FSM chain `interview-complete → information-architecture-in-progress → information-architecture-complete`.
- `InfoArchitectAgent` — the LLM-backed agent. Subscription-only (`@chiefaia/claude-spawner`); pay-per-token API keys are forbidden.
- `IaPersistence` interface + `IaMemoryPersistence` (tests) + `IaPostgresPersistence` (production).
- `buildIaSystemPrompt()` — composable system-prompt builder covering the 11 IA pillars and the 5 credential-UI archetypes (A-OAuth / B-API token / C-DNS / D-Webhook / E-DB-SMTP-SSH).

## Three canonical artifacts

1. **`pagesCatalogue`** — sitemap + page templates + ordered section stacks + widget references.
2. **`designSystem`** — color/typography/spacing/motion tokens + light/dark theme mapping + Tailwind config.
3. **`componentsLibrary`** — Atomic-Design catalogue where every component has a stable globally-unique ID.

## State-machine integration

This package is the authoritative caller for the IA FSM transitions defined in `@caia/state-machine`:

```
interview-complete
  → information-architecture-in-progress
  → information-architecture-complete
  → proposal-generated
```

The legacy direct edge `interview-complete → proposal-generated` was removed in ADR-024.

## Subscription-only

All LLM calls go through `@chiefaia/claude-spawner` with `rejectIfApiKeyPresent: true`. The agent throws `InfoArchitectError('subscription_only_violation')` if `ANTHROPIC_API_KEY` is present in the calling process env.

## Schema

Three per-tenant tables: `pages_catalogue`, `design_systems`, `components_library`. Apply with the `0001_info_architect.sql` migration, substituting `{{SCHEMA}}` with the tenant schema name (mirrors `@caia/grand-idea`'s template pattern).

## See also

- `research/info_architect_agent_spec_2026.md` — the full 1783-line spec
- `caia-ea/decisions/ADR-024-information-architect-canonical-step.md`
- `agent-memory/project_caia_shadcn_react_first_locked.md` — the canonical UI-stack decision
