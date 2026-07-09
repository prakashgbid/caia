# Pause-state archive — caia — 2026-07-08

## Why this file exists

Focus is shifting to the Stolution project. Non-Stolution repos are being paused with handoff documentation so a cold-start resume (weeks or months from now) is possible without hunting through git history and memory. `RESUME_HERE.md` is the operator-facing summary; this file is the verbose archive — read after `RESUME_HERE.md` if you need more.

## Repo identity

- **Name:** `caia`
- **Owner:** prakashgbid (personal)
- **Visibility:** public (per the repo policy — the repo is public but the packages are private-first via `"private": true` in each `package.json` and no scope publish; see AGENTS.md "Option E shape")
- **Purpose:** umbrella monorepo for the Chief AI Agent platform
- **Size at pause:** 44 MB working tree (excluding `.git`), 11 MB `.git`, 146 packages, 21 apps, 874-KB pnpm lockfile, ~875 KB single-file lockfile is a decent proxy for dependency breadth

## Absorption history (why the repo is so large)

Between 2026-04-24 and 2026-04-28 this repo went from a bootstrap stub to the current shape by absorbing 7 predecessor repos in a single milestone. From `MIGRATION-STATUS.md`:

| Source repo | Absorbed as | Notes |
|---|---|---|
| `prakashgbid/conductor` | `apps/orchestrator/` + 6 sub-apps + `apps/dashboard/` + internal `packages/*-internal/` | Conductor engine + sub-apps + dashboard. Squash-import. |
| `prakashgbid/image-provider` | `packages/image-provider/` | Renamed to `@chiefaia/image-provider`. Changeset for v0.1.0 landed. |
| `prakashgbid/conductor-state` | archived on GitHub | Filesystem-only state, no repo needed |
| `prakashgbid/framework` | `docs/legacy-framework/` | Governance-doc heavy, mostly ADRs + runbooks. Archived. |
| `prakashgbid/pokerzeno-framework` | `docs/legacy-pokerzeno-framework/` | Same pattern. Archived. |
| `prakashgbid/pokerzeno-plugins` | 7 `packages/*` under `@pokerzeno/*` scope | analytics, backend-core, cast-bridge, content-engine, dev-inspector, integrity-check, seo-program |
| `prakashgbid/site-template` | `templates/site/` | `file:../*` deps rewritten as `workspace:*` |
| `prakashgbid/pokerzeno-site-template` | `templates/site-pokerzeno/` | Lifted as-is |
| `prakashgbid/conductor` `plugins/` workspace | `apps/completeness-sentinel/` + 4 `packages/` | `@plugins/*` scope rewritten to `@chiefaia/*` |

The milestone is called "conductor-lift complete" and lived across PRs #48–#58 plus parallel #49 for `@chiefaia/local-llm-router`. Every capability the predecessor repos had is now here.

Also worth noting: the matrix originally listed 9 agents, but only 6 (`scaffolder`, `po-agent`, `ba-agent`, `task-scheduler`, `testing-agent`, `release-agent`) had actual source. The other 3 (`ea-agent`, `dba-agent`, `platform-agent`) were planned but never written — their absence is *not* a regression.

## History summary at pause

- **Created:** repo predates the absorption; first bootstrap in early 2026 (per `ARCHITECTURE-MIGRATION.md` "Phase 0 — Bootstrap complete")
- **Last commit on develop:** `a6f5bdb feat(@caia/billing,@chiefaia/claude-spawner): C3 — per-tenant Claude usage meter (stub-mode) (#647)` — 2026-05-31 22:27 -0400
- **Last push:** 2026-06-08 (per the triage table — bots kept pushing hygiene reports and dependabot bumps after the last human feature commit)
- **Author distribution (last 30 commits):** github-actions bot 24, Prakash direct 5, dependabot 1. Effectively single-operator with heavy automation.

## Phase-C timeline (the pause is here)

The recent commit stream reveals a Phase C plan of roughly C1–C8, landed in this order:

1. **C7 (#640)** — 2-replica wizard with sticky sessions
2. **C1 (#637)** — HPA on chiefaia-wizard + chiefaia-dashboard
3. **C4 (#639, ADR-067)** — snapshotter row-level tenant_id as V1 carve-out
4. **C2 (#643, #644)** — Grafana OSS in `chiefaia` ns + Tempo + 3 dashboards + tunnel label
5. **C5 (#730dd80)** — SSE replaces polling in `@caia/atlas-ui`
6. **C8 (#646)** — Prometheus + Alertmanager + SLO burn-rate alerts
7. **C3 (#647)** — per-tenant Claude usage meter, **stub mode** — THE PAUSE COMMIT

**C6 is missing from the visible commit stream.** Whether that's because it was skipped, subsumed by another phase, or is still in draft — need to check on resume.

C3's stub-mode design (per `PLAN.md`): the code path activates when `STRIPE_SECRET_KEY` lands in Infisical at `caia_global.billing.stripe_secret_key`. Reuse-search-approved (`@caia/billing`, `@chiefaia/claude-spawner`, `@caia/secrets-adapter`, `@chiefaia/tracing`). 35 new vitest cases. Migration `0003_tenant_usage_meter.sql` added.

## Phase-B timeline (the layer beneath)

Phase B ran roughly 2026-05-24 to 2026-05-30. Wizard UX depth. Landed:

- B1 — per-step error boundaries with Tempo tracing
- B3 — wrap wizard claude-spawner calls with OTel spans
- B5 — FSM lifecycle events on NATS
- B6 — critic-loop UI for IA + Interview steps
- B7 — retry+backoff wrapper for wizard Claude calls
- B8 — GDPR rights surface

Left as drafts at pause:

- **B2 (draft PR #638, branch `feature/wizard-b2-real-claude-design-adapter-2026-05-31`)** — real Claude design adapter
- **B4 (draft PR #632, branch `feature/wizard-b4-search-path-2026-05-31`)** — wizard search path

## Phase-A timeline (the foundation)

Phase A was the wizard/dashboard split + app-side plumbing:

- A3 — per-tenant migration orchestrator (`@caia/wizard-tenant-bootstrap`)
- A11 — live wizard E2E smoke + runbook + nightly CI
- Assorted app-side fixes: WIZARD_AUTH_MODE branching, OTel vendoring for standalone Next builds, splitting customer wizard from operator dashboard, Next `outputFileTracingIncludes` fixes

## Package inventory highlights

146 packages is too many to list. High-signal ones:

**Core primitives (`@chiefaia/*`, published):** `logger`, `metrics`, `tracing`, `events`, `secrets`, `config`, `errors`, `test-kit`, `http-client`, `persistence-sqlite`, `persistence-postgres`, `image-provider`.

**Agent kit (`@caia/*`, private):** `architect-kit`, `agent-contract-registry`, `architecture-registry`, `claude-spawner`, `claude-subagents`, `capability-broker`, `chain-runner`, `chain-scaffolder`, `code-reviewer`, `critic`, `billing`.

**Apprentice sub-family:** `apprentice-corpus`, `apprentice-eval`, `apprentice-retrainer`, `apprentice-serving`, `apprentice-training` — a local-LLM apprentice model track.

**Atlas sub-family:** `atlas-design-snapshotter`, `atlas-mapper`, `atlas-prompt-router`, `atlas-ui` — the design-snapshot / prompt-router surface.

**Internal (not published):** `event-bus-internal`, `events-taxonomy-internal`, `secrets-broker`, `story-decomposer`, `dead-shell-detector`, `behavior-suite`.

**Pokerzeno-scoped libs (`@pokerzeno/*`, sites consume from npm):** `analytics`, `backend-core`, `cast-bridge`, `content-engine`, `dev-inspector`, `integrity-check`, `seo-program`.

**Stolution-bound:** `apps/stolution-mcp/` (`@stolution/mcp-server`) — MCP server exposing the stolution remote filesystem, shell, docker, pm2, vault, postgres over SSH stdio. Lifted from conductor in PR #57.

## CI / workflow inventory

20+ GitHub Actions workflows in `.github/workflows/`:

- Required checks: `ci.yml`, `gitflow-conformance.yml`, `reuse-advisory-blocking` (part of `ci.yml`)
- Evidence gates: `evidence-gate.yml`, `promptfoo-eval.yml`, `live-wizard-smoke.yml`, `pipeline-regression.yml`
- Publishers: `chiefaia-site-publish.yml`, `dashboard-publish.yml`
- Dependency + hygiene: `dependabot-triage.yml`, `hygiene-report.yml`, `auto-pr.yml`, `post-merge-signal.yml`, `release.yml`
- Reviewers: `code-reviewer.yml`, `browserless-config.yml`
- Sharded tests: `fix-it-sharded-tests.yml`, `fix-it-sharded-tests-meta.yml`
- Utility: `docs.yml`, `mcp-vendored-verify.yml`, `memory-rule-enforceable.yml`

`hygiene-report.yml` runs daily and opens the "Git Hygiene — YYYY-MM-DD" issues. `dependabot-triage.yml` runs whenever Dependabot creates PRs and opens the "Dependabot Triage — YYYY-MM-DD" issues. Both are informational.

## Standing rules (fold-out)

From `AGENTS.md` "Reuse-first (mandatory)" section — the mechanical-enforcement stack:

- **L1** — this section. Doctrine.
- **L2** — EA gate. Plans through `@caia/reuse-check-gate` must include `reuseSearchResults`. Empty results = refusal.
- **L3** — dispatch-time reuse search. Orchestrators call `searchReuseCandidates(brief)` from `@caia/reuse-searcher` before spawning any code task.
- **L4** — CI gate. `reuse-advisory-blocking` is a required status check on `develop` + `main`.
- **L5** — Semgrep. `.semgrep/caia-rules.yml` blocks raw shadcn/Radix/Tailwind outside `packages/ui/**`, raw axios/fetch outside `packages/http-client/**`, raw better-sqlite3 outside `packages/persistence-*/**`.

Escape hatch: `reuse-advisory-escape` PR label after EA-reviewer records rationale.

## Open loops at pause

- **3 Dependabot PRs:** #650, #658, #660 — bulk npm_and_yarn bumps
- **5 signal `develop-red` issues:** #391 pipeline-regression (the real block), #390 auto-pr.yml, #389 visual regression, #388 lighthouse (warn-only), #387 axe (warn-only)
- **2 draft PRs:** #632 (B4 search path), #638 (B2 real Claude design adapter)
- **Automation:** daily hygiene + triage issues continue to accumulate (latest #694 dated 2026-07-08 — that's today; the bots ran during the pause pass)

## Notes for future me

- **The "True-Zero admin-merge" pattern in commit messages means "operator vetted this merge past the persistently-red check #391".** It is a governed exception, not a lax habit. Do not cargo-cult it — every use should be justified.
- **The `chiefaia-site` repo (Pages placeholder) is different from `apps/chiefaia-site/` (Next marketing site inside this monorepo).** Two things with the same name. The monorepo version is the real one; the placeholder repo is left for the domain-parking landing only.
- **The `stolution-mcp/` app is Stolution's MCP shim.** It was lifted from conductor and lives here because the code is generic. But its config points at the Stolution remote. Do not delete it during any cleanup pass — Stolution work uses it.
- **Templates are consumers, not sources.** If you edit `templates/site/`, remember that new sites will get the change. Existing sites won't.
- **Phase-D was not named in any doc I found.** Whether Phase C wraps and rolls into an unnamed Phase D, or into something Stolution-specific, is a decision to be made on resume.
- **The `EA-REVIEW-OUTCOME.json` at repo root is not stale — it's the EA-gate outcome for the LAST reviewed plan.** Overwritten on the next plan review. If you find it referring to something older than the last commit, that's fine; if newer, someone's mid-plan.

## Resume verification (deeper)

Beyond the RESUME_HERE.md checklist:

```bash
# See real state of develop
git checkout develop && git pull --ff-only
git ls-remote --heads origin | wc -l   # branch count; expect many feature/*

# Are the draft PRs still there?
gh pr view 632
gh pr view 638

# Is C3 activated?
gh secret list --repo prakashgbid/caia | grep -i stripe  # or check Infisical directly

# Is C6 anywhere?
find . -type f \( -name '*.md' -o -name '*.ts' \) | xargs grep -l 'C6\b' 2>/dev/null | head
grep -rn 'Phase C6' docs/ apps/ packages/ 2>/dev/null | head
```

If C6 has no artifacts anywhere, then Phase C ships incomplete or the numbering skipped C6 by convention.

