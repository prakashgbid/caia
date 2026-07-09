# RESUME_HERE — caia

> **PAUSED 2026-07-08.** Focus shifted to Stolution. To resume: read this top-to-bottom (~10 min), verify state, pick up at §3.
>
> **This is the big one** — 146 packages, 21 apps, 124 ADRs, active phase-C work in flight. Do not skim.

## 1. What this repo is

`caia` — **Chief AI Agent** — is the private umbrella monorepo for the multi-agent AI software-development platform. Its job is to be the *single* place where everything generic (non-site-specific) lives. Individual sites (pokerzeno, ROULETTECOMMUNITY, chiefaia-site, prakash-tiwari-com, stolution) live in their own repos and either consume `@chiefaia/*`/`@caia/*` packages from npm or stay remote-only.

Concretely, this monorepo contains:

- **21 apps** (`apps/`) — the runnable systems: `orchestrator` (Conductor engine), `executor` (task daemon), `dashboard` + `admin` + `wizard` (Next.js UIs), `chiefaia-site` (Next.js marketing site — different from the `chiefaia-site` GitHub Pages placeholder repo), `completeness-sentinel`, `db-backup`, `story-backfiller`, `task-run-poller`, `pipeline-pulse`, `orchestrator-middleware`, `stolution-mcp`, `local-preview-orchestrator`, `mesh-supervisor`, `roulette-backend`, `smart-cicd-agent`, `worker-coding`, `worker-fix-it`.
- **146 packages** (`packages/`) — the reusable pieces. Two npm scopes: `@chiefaia/*` (published, workspace consumable) and `@caia/*` (internal / private-first). Includes core primitives (`logger`, `metrics`, `tracing`, `events`, `secrets`, `config`, `errors`, `test-kit`), architect kits, agent contracts, `claude-spawner`, `billing`, `atlas-*` (design snapshotter + prompt router + UI), `apprentice-*` (apprentice-model training/serving/eval), etc.
- **3 template families** (`templates/`) — `site`, `site-pokerzeno`, `utility`.
- **124 ADRs** (`docs/adr/`) — architectural record. Latest important one is **ADR-067** (snapshotter row-level tenant_id is the V1 carve-out). Chronology skips a lot of numbers because the middle range is legacy.
- **All the CI muscle**: 20+ GitHub Actions workflows including `gitflow-conformance` (required check), `evidence-gate`, `reuse-advisory-blocking`, `pipeline-regression`, `hygiene-report`, `dependabot-triage`, `code-reviewer`, `promptfoo-eval`.

The **absorption history** matters and is documented in `MIGRATION-STATUS.md`: `conductor`, `image-provider`, `framework`, `pokerzeno-framework`, `pokerzeno-plugins`, `site-template`, `pokerzeno-site-template` were all squash-imported into this monorepo in 2026-04-28's "conductor-lift complete" milestone (PRs #48–#58). Those source repos are archived; only `caia` is live.

## 2. Where we paused

- **Last commit on `develop`:** `a6f5bdb` — `feat(@caia/billing,@chiefaia/claude-spawner): C3 — per-tenant Claude usage meter (stub-mode) (#647)` — **2026-05-31 22:27 -0400**.
- **Pattern:** we are mid-way through **Phase C** (post-Phase-B production/scale work).
  - Phase A (~2026-05-04 – 2026-05-24) — foundation: separating customer wizard from operator dashboard, wizard-tenant-bootstrap, live-wizard smoke, WIZARD_AUTH_MODE, Next.js standalone plumbing, dependency vendoring for OTel.
  - Phase B (~2026-05-24 – 2026-05-30) — wizard UX depth: per-step error boundaries (B1), OTel-wrapped Claude calls (B3), retry+backoff (B7), FSM lifecycle events on NATS (B5), critic-loop UI (B6), GDPR rights surface (B8), plus B2/B4 in draft.
  - Phase C — production/scale: HPA on wizard+dashboard (C1), Grafana OSS + Tempo + dashboards (C2), **C3 — per-tenant Claude usage meter (stub-mode) — this is the pause commit**, ADR-067 snapshotter tenant_id (C4), SSE replaces polling (C5), 2-replica wizard with sticky sessions (C7), Prometheus + Alertmanager + SLO burn-rate alerts (C8).
- **Implied "next action" from the commit stream:** C3 was landed in **stub mode** — the code path activates when `STRIPE_SECRET_KEY` lands in Infisical at `caia_global.billing.stripe_secret_key`. So the literal next step operator would take is either (a) drop the Stripe key in and flip C3 live, or (b) continue Phase C (C6 was not visible in the recent commits — check whether it exists as a plan doc; a phase-C plan of C1–C8 with a gap at C6 is worth checking on resume).
- **Branches:** clone only sees `main` and `develop`. In practice there will be many `feature/*` branches on the remote. Run `git ls-remote --heads origin | head -30` on resume to see the actual set.
- **Dirty state at pause:** none. Clone was clean.
- **PR queue at pause:** 3 open, all Dependabot npm_and_yarn bulk bumps (#650, #658, #660). No human-authored PRs open.
- **Signal issues open:** **5 `[develop-red]` pipeline issues** (see §7).

## 3. Architecture snapshot

```
caia/
├── apps/                # 21 apps — see §1
├── packages/            # 146 packages under @chiefaia/* and @caia/*
├── templates/           # site / site-pokerzeno / utility
├── configs/             # shared eslint, tsconfig, semgrep configs
├── docs/                # 124 ADRs + operator/architecture docs
│   ├── adr/             # ADR-001..067
│   ├── operator/        # runbooks
│   └── legacy-*/        # absorbed conductor, framework, pokerzeno-framework docs
├── infra/, infrastructure/  # k8s manifests, Prometheus/Grafana configs
├── services/            # deployable services
├── scripts/             # ops scripts
├── launchd/             # macOS launchd plists (see MIGRATION-STATUS.md for cutover)
├── vendored-mcp/        # vendored MCP server bits
├── AGENTS.md            # AI-agent coding conventions (reuse-first, 5-layer enforcement)
├── ARCHITECTURE-MIGRATION.md
├── MIGRATION-STATUS.md  # absorption record
├── PLAN.md              # currently: C3 plan
├── EA-REVIEW-OUTCOME.json  # EA gate outcome for current PR
└── pnpm-workspace.yaml, turbo.json, package.json
```

- **Tech stack:** TypeScript (strict, ESM), Node ≥20, pnpm 9 (lockfile committed), turbo, Hono for microservices, Next.js for UIs, vitest primary + jest in some packages, Playwright for E2E, Semgrep + gitleaks + reuse-check for gates.
- **Infra layer:** Kubernetes (`chiefaia` namespace), Prometheus + Alertmanager + Grafana OSS + Tempo, Infisical for secrets (`caia_global.*` path), Cloudflare Tunnel for exposure, NATS for events, Postgres for tenant DBs (per-tenant migration orchestrator in `@caia/wizard-tenant-bootstrap`).
- **Contributor list:** Prakash (5 direct commits) + `github-actions[bot]` (24) + `dependabot[bot]` (1). Effectively single-operator with heavy automation.

## 4. Standing decisions

Non-negotiables, recorded in ADRs and `AGENTS.md`:

- **Reuse-first is mandatory, enforced at 5 levels (L1 doctrine → L5 Semgrep).** No raw `axios`/`fetch` outside `@chiefaia/http-client`. No raw `better-sqlite3`/`pg.Pool` outside `@chiefaia/persistence-*`. No raw shadcn/Radix/Tailwind outside `packages/ui/**`. The `reuse-advisory-blocking` CI check is required on `develop` + `main`. Escape hatch: `reuse-advisory-escape` label after EA-reviewer records rationale.
- **Strict git flow (ADR-015):** `feature/<id>-<slug>` → PR to `develop` → squash-merge → branch deleted. `develop` → `release/<date>` PR → `main` → tag. Direct commits/pushes to `main`/`develop` blocked locally (Husky) + server-side (branch protection + `gitflow-conformance` required check).
- **Develop is canonical mirror of main (ADR-016).**
- **Custom Hono runtime (ADR-009).** Four-layer safety stack (ADR-010). Evidence gate (ADR-011). Steward gatekeeper (ADR-012). Single-threaded write per worktree (ADR-013). HashiCorp Vault (ADR-014) — later superseded by Infisical migration.
- **"True-Zero admin-merge"** — the tag appearing on many commits — is the operator's manual override pattern used when a required check is stuck for a known non-blocker (e.g. legacy TS2352, unstable lighthouse). Documented (or should be) as a governed exception. Do NOT interpret this as "checks don't matter" — it means the operator individually vetted each of those merges.
- **AGENTS.md is the coding-agent conventions doc.** Every AI agent operating on this repo (Claude Code, Aider, Copilot, Cursor) reads it. Standing rules live in `agent/memory/`.
- **Sites stay in their own repos.** This monorepo does not absorb site content, only shared packages.

## 5. Decided-but-not-built

- **C3 is stub-only until Stripe key ships in Infisical.** Wiring is live; billing is a no-op meter. Activation is a config-only change.
- **Phase C is incomplete.** Known landed: C1, C2, C3, C4, C5, C7, C8. Gap in the visible commit stream: **C6 was not merged** — check plan docs / open drafts to see whether it's in flight or unstarted.
- **Draft branches with open work at pause (from commit stream titles):**
  - `feature/wizard-b2-real-claude-design-adapter-2026-05-31` (draft PR #638) — B2 real Claude design adapter for the wizard.
  - `feature/wizard-b4-search-path-2026-05-31` (draft PR #632) — B4 wizard search path.
- **`ARCHITECTURE-MIGRATION.md` phases 6–9** were plans, not commitments — verify against reality before executing.
- **3 open Dependabot PRs:** #650, #658, #660 — bulk npm_and_yarn security bumps. Batch-merging these is a good first-day-back warm-up if CI is green.

## 6. Known broken / needs-attention

**`develop` is red.** Five persistent CI failures tracked as `[develop-red]` issues:

| # | Issue | Since | Kind |
|---|---|---|---|
| #391 | pipeline-regression (E2E + per-agent) failing on develop | 2026-05-04T03:59 UT | E2E |
| #390 | `auto-pr.yml` failing on certain branch contexts (workflow-file parse) | (open) | workflow |
| #389 | Evidence Gate / visual regression failing (no committed baseline) | ~2026-04-24 | visual |
| #388 | Evidence Gate / lighthouse failing (a11y minScore, warn-only) | ~2026-04-24 | perf |
| #387 | Evidence Gate / axe failing (dashboard a11y, warn-only) | ~2026-04-24 | a11y |

Of these, **#391 (pipeline-regression) is the real block** — the other four are warn-only or infrastructure-only. But every merge to `develop` since 2026-05-04 has needed `True-Zero admin-merge` because #391 stays red. Fixing #391 unblocks the auto-merge path.

**Nightly automation is running:** the daily `Git Hygiene` + `Dependabot Triage` issue-generators are still landing new issues (see #692, #693, #694 dated 2026-07-06/07/08). Those are informational, not action items — but if they accumulate an explicit `action-required` label, that's the signal.

**Absorption launchd-cutover** — see `MIGRATION-STATUS.md` "Launchd Cutover" table. If the operator's dev laptop still runs launchd jobs pointed at old `conductor/` paths, `scripts/migrate-launchd.sh` handles the switch. Not urgent if you're not running the daemons locally.

## 7. Resume verification

```bash
git clone git@github.com:prakashgbid/caia.git
cd caia
git checkout develop     # canonical branch — not main

# Sanity
git log --oneline -5     # confirm still at a6f5bdb (or newer if bots kept working)
git status               # should be clean
pnpm install             # 1119+ deps, expect ~2min

# Full check (the four required gates)
pnpm build               # turbo build — expect first-run to take 5-10min
pnpm typecheck           # tsc --noEmit per workspace
pnpm test                # vitest across workspaces
pnpm lint                # eslint per workspace

# Deep check
pnpm exec semgrep ci     # reuse-first rules
pnpm changeset status    # any unshipped changesets?

# See what CI thinks
gh pr list --limit 30
gh issue list --label develop-red   # should still show #387..#391 unless fixed
```

If `pnpm install` fails: check Node version (`node -v` — must be ≥20) and pnpm version (`pnpm -v` — must be 9.x). The `.npmrc` and `pnpm-lock.yaml` are pinned.

If `pnpm build` fails on a package you didn't touch: probably a transitive workspace dep drift — try `pnpm build --filter '...^<package-you-were-working-on>'` scoped, and open the failure trail before assuming rot.

## 8. Pointers

**In-repo docs (read in this order on resume):**

1. `README.md` — the current layout snapshot.
2. `AGENTS.md` — coding conventions (mandatory before touching code).
3. `MIGRATION-STATUS.md` — absorption history.
4. `ARCHITECTURE-MIGRATION.md` — the 9-phase evolution plan (phases 6–9 aspirational).
5. `PLAN.md` — plan doc for the currently-active phase-C task (last written was C3).
6. `EA-REVIEW-OUTCOME.json` — EA gate outcome for the current-in-flight change.
7. `docs/adr/` — the 124 ADR archive; scan filenames, read ADR-067 first (the most recent).
8. `docs/git-flow.md` — the full operator runbook for the git flow.
9. `docs/operator/` — runbooks.
10. `agent/memory/feedback_git_flow_enforced.md` — standing rules (if present).

**Related repos:**

- Sites this platform builds for: `pokerzeno`, `ROULETTECOMMUNITY`, `chiefaia-site` (Pages placeholder), `prakash-tiwari-com`, `stolution` (remote-only).
- Templates spawned from this: `templates/site*` produces the sites above; `templates/utility` produces `@chiefaia/*` scaffolds.

**External:**

- Infra: Kubernetes `chiefaia` namespace. Cloudflare tunnel exposes `net.chiefaia.io/exposed-via=tunnel`-labelled pods.
- Live services: chiefaia.com (Next marketing site — deployed from `apps/chiefaia-site` per commit #613), plus dashboard and wizard endpoints (see `infra/`).

## 9. First-five-minutes-back

1. `git checkout develop && git pull --ff-only` — get the latest. Bots may have landed dependency bumps or hygiene reports.
2. `gh issue list --label develop-red` — is #391 still red? If yes, no functional work can auto-merge — reserve fixing it as top-priority. If no, someone (or a future you) fixed it and gates are back.
3. `gh pr list` — are Dependabot PRs stacked up? If more than ~5, this is a signal to run a triage pass before starting any new work.
4. `cat PLAN.md` — was Phase C the last thing, or did someone leave a new PLAN.md? The presence of an unfamiliar plan means someone (or you) queued the next task.
5. Grep for `TODO(prakash)` or `TODO(operator)` in `apps/wizard/` and `packages/billing/` — those are the two areas with the most in-flight work.

If all five pass clean, you're back. If any point surprises you, stop and re-read this file plus `docs/pause-state-2026-07-08.md`.

---

*Handoff written 2026-07-08 during pause pass. See `docs/pause-state-2026-07-08.md` for the deeper narrative — phase-by-phase, package-by-package. This document is the operator-facing summary; that one is the archive.*
