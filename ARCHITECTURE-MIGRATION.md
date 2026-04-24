# Architecture Migration Plan

This document records the 9-phase plan for evolving CAIA from stub to production ecosystem.

## Current State (Phase 0 — Bootstrap complete)

- Monorepo structure: `packages/`, `configs/`, `templates/`, `docs/`
- 8 Tier 1 stubs + CLI + 3 shared configs
- All packages compile, tests pass, changesets configured
- GitHub Actions: CI, Release, Docs

---

## Phase 1 — Tier 1 Real Implementations

Migrate each stub to a production-quality implementation.

| Task | Target | Depends on |
|------|--------|------------|
| Wire `@chiefaia/logger` → Pino | logger | pino package |
| Wire `@chiefaia/metrics` → prom-client | metrics | prom-client |
| Wire `@chiefaia/tracing` → OTel SDK | tracing | @opentelemetry/* |
| Add Zod schema support to `@chiefaia/config` | config | zod |
| Wire `@chiefaia/secrets` → SshFileVaultAdapter | secrets | @plugins/secrets-broker |
| Expand `@chiefaia/test-kit` with real mocks | test-kit | All Tier 1 |

---

## Phase 2 — Domain Utilities

Domain-specific utilities consumed by Tier 5 sites. Examples:
- `@chiefaia/pagination` — cursor + offset pagination helpers
- `@chiefaia/search` — OpenSearch/Meilisearch client abstraction
- `@chiefaia/cache` — Redis-backed cache with TTL

---

## Phase 3 — AI Agent Primitives

Foundation for agent development:
- `@chiefaia/agent-core` — base agent lifecycle, tool registry, memory interface
- `@chiefaia/llm-client` — LLM provider abstraction (Anthropic, Mistral, OpenAI)
- `@chiefaia/tool-registry` — typed tool definitions for agents

---

## Phase 4 — CAIA Core (Orchestration)

The "chief" layer:
- `@chiefaia/conductor` — multi-agent orchestration engine
- `@chiefaia/workflow` — DAG-based workflow execution
- `@chiefaia/memory` — cross-session agent memory

---

## Phase 5 — CLI Full Implementation

- `caia new utility <name>` — full file scaffold with real substitution
- `caia new site <name>` — full Next.js site scaffold from template
- `caia doctor` — comprehensive compliance checks
- `caia publish` — guided release workflow

---

## Phase 6 — Tier 5 Site Migration

Migrate existing sites (poker-zeno, roulette-community) to consume `@chiefaia/*` packages:
- Replace ad-hoc logging with `@chiefaia/logger`
- Replace env reading with `@chiefaia/config`
- Replace secrets env files with `@chiefaia/secrets`

---

## Phase 7 — Documentation Site

Build out `docs/` into a full documentation site:
- Full API reference for every package
- Guides: logging, tracing, config, secrets
- Migration guides for Tier 5 sites
- Deploy to `chiefaia.com`

---

## Phase 8 — npm Publishing

When Tier 1 packages are production-ready:
1. Create `@chiefaia` npm organisation (scope `@chiefaia` is available)
2. Set `NPM_TOKEN` GitHub secret
3. Merge a version PR to trigger the Release workflow
4. Verify packages appear on registry

---

## Phase 9 — Ecosystem Expansion

- BJANA App integration
- New site scaffold using `caia new site`
- Community contribution guide
- Changelog automation and release notes

---

## Decision Log

| Date | Decision | Reason |
|------|----------|--------|
| 2026-04-24 | Monorepo (pnpm + turbo) over multi-repo | Easier cross-package refactoring; sites stay separate |
| 2026-04-24 | Scope `@chiefaia` (not `@caia`) | `@caia` org is owned by another npm user |
| 2026-04-24 | Changesets (not Lerna) | Leaner, no legacy baggage, better DX |
