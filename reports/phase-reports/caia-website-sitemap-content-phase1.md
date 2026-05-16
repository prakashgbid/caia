---
name: caia-website-sitemap-content-phase1
created: 2026-05-16T09:08:06Z
updated: 2026-05-16T09:08:06Z
status: complete
type: phase-report
chain: caia-website-sitemap-content / phase 1 of 1
spawn_id: phase1-20260516T090352-66544
scope: docs/website-design-system
---

# Phase Report — caia-website-sitemap-content (phase 1 of 1)

**Deliverable**: `docs/website-design-system/sitemap-and-content-plan.md` — ~6,800 words.

## What I did

1. **Surveyed source material**: `README.md`, `AGENTS.md`, `ARCHITECTURE-MIGRATION.md`, the EA reference set in `docs/` (business / capability-map / intelligence / communication / value-stream / data-ownership / information-classification), the ten ADRs (ADR-006..015), the prior dashboard audit at `reports/audits/2026-05-16-caia-dashboard-codebase-audit.md`, and 40+ package READMEs (chain-runner, claude-spawner, local-llm-router, librarian, apprentice-*, capability-broker, guardrails-validator, mcp-allowlist-proxy, tool-output-sanitizer, aiml-architect, vastu, critic, code-reviewer, prompt-evals, prompt-optimizer, architecture-registry, feature-registry, agent-contract-registry, system-prompt-block, hmac-auth, dspy-bridge, steward-*, researcher, verifier, etc.).
2. **Extracted visual-identity hints** from `apps/dashboard/app/layout.tsx`, `globals.css`, `components/nav/Sidebar.tsx`, and `components/nav/groups.ts` — palette, font stack, accordion-style nav, screenshot subjects.
3. **Authored** a comprehensive sitemap + content plan covering:
   - **§1 Audiences** — three archetypes (technical visitor, collaborator/hire, operator) with triggers + primary paths + exit wins.
   - **§2 Top-level navigation** — seven sections (Home, Architecture, Packages, Concepts, Documentation, About, Login) plus a persistent `Dashboard →` CTA.
   - **§3 Page-by-page outline** — Home (5 sections), Architecture (7 sub-views: Business, Application, Information, Communication, Intelligence, Operations, Value-stream), Packages (landing + per-package template + 10 curated picks), Concepts (7 long-reads: event-driven, observability, smart prompting, autonomous chains, apprentice LoRA, safety stack, knowledge graph), Documentation (runbooks + ADR register + getting-started + API references), About (operator + principles + flow), Login. Each page lists section breakdown, 2–3 paragraph drafts per section, and supporting-visual notes.
   - **§4 User journeys** — operator-login, technical-visitor-learning, deep-dive-collaborator with step-by-step traces.
   - **§5 Cross-link patterns** — seven contracts: Architecture↔Packages, Concepts↔Packages, Concepts↔ADRs, ADRs↔Standing-rules, Home↔Everything, Dashboard↔Public-site, Footer-wide.
   - **§6 Cross-cutting notes** — visual identity (dashboard palette + spacing), content voice, 15 diagrams to commission, 8 dashboard screenshots to take, code samples to embed, accessibility + perf budgets, SEO, explicit out-of-scope list.
   - **§7 Implementation hand-off** — recommended build order in 7 phases.

## Decisions made autonomously

- **Output path** was inferred from the empty `docs/website-design-system/` directory that the prior phase had pre-created.
- **Seven top-nav sections** (vs the 5–6 floor) was chosen because the platform genuinely splits seven ways; collapsing further would conflate Architecture-views with Concept-essays or Packages-catalog with Documentation-runbooks.
- **Architecture as one page with sub-tabs** rather than seven separate pages — reduces nav noise; matches how the EA reference set is organised in `docs/` today.
- **Concepts as long-form essays** (1,500–3,000 words each), not summaries — these are the social-shareable surface and need depth.
- **Per-package detail page is a single template**, generated at build time from each `packages/*/README.md` — avoids 74 hand-authored pages.
- **Login page sits inside the public site** at `/login` but the dashboard remains served from its existing origin (`:7777`); the public site never embeds dashboard content.
- **Visual identity** borrows the dashboard's exact palette (`#0f1117` background, `#1a1f2e` panel, `#63b3ed` link, etc.) so the transition from public site to dashboard feels seamless.
- **No blog, no newsletter, no comments, no search** in Phase 1 — explicitly out-of-scope per the operator's standing rule that open-sourcing is not a priority.

## Files touched

- `docs/website-design-system/sitemap-and-content-plan.md` (new) — 6,784 words, 48,517 bytes.
- `reports/phase-reports/caia-website-sitemap-content-phase1.md` (this file).

## What the next phase would naturally do

This is phase 1 of 1, so no chained successor is queued. A natural follow-up (when the operator approves the plan) would be:

- Phase 2 — site repo scaffold (Next.js 15 with App Router; apply the §6.1 visual identity; build layout + header + footer + nav).
- Phase 3 — commission the 15 diagrams from §6.3 and capture the 8 screenshots from §6.4.
- Phase 4 — author the 7 Concept long-reads (each its own chain phase, drafted from §3.4).
- Phase 5 — generate the Packages catalog from `packages/*/README.md` at build time; populate the per-package right-rail dependency graphs.
- Phase 6 — author Architecture views (one chain phase per sub-view).
- Phase 7 — Documentation index from `docs/runbooks/*` and `docs/adr/*`.
- Phase 8 — Login + dashboard hand-off; SEO + a11y + perf gates.

OPERATOR_ACTION_REQUIRED: none.

## Heartbeat note

`caia-chain heartbeat` was attempted but the chain-runner package is unbuilt in this worktree (`dist/cli.js` missing). The bash dispatcher's background heartbeat handles liveness; in-prompt belt-and-suspenders heartbeat was best-effort and degraded gracefully as documented in the prompt.
