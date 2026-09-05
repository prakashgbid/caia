> ⚠️ **Project deprioritized on 2026-09-05.** Active development is paused. Before touching anything in this repo — including PR reviews, dependency bumps, or CI changes — read [`docs/HANDOFF.md`](docs/HANDOFF.md) end-to-end. It contains the full state-of-play, kill-switch status, known-broken items, deferred features, and a restart checklist. Do not resume feature work without operator sign-off.

---

# CAIA Deprioritization Handoff

**Authored**: 2026-09-05
**Author**: Claude (autonomous session, operator-authorized)
**Primary copy**: `docs/HANDOFF.md` in `prakashgbid/caia`
**Mirror**: `/home/s903/HANDOFF.md`
**Status at authoring**: Project paused. Kill switch engaged. No active agents.

---

## Table of Contents

1. [Purpose & Scope](#1-purpose--scope)
2. [TL;DR — State at Pause](#2-tldr--state-at-pause-2026-09-05)
3. [CAIA Architecture Overview](#3-caia-architecture-overview)
4. [Live Services & Endpoints](#4-live-services--endpoints)
5. [Kill Switch — DO NOT LIFT](#5-kill-switch--do-not-lift-stol-6799)
6. [Known Broken Items](#6-known-broken-items-prioritized)
7. [Factory Pipeline State](#7-factory-pipeline-state)
8. [Wizard — dashboard.chiefaia.com](#8-wizard--dashboardchiefaiacom)
9. [Repository Structure & Navigation](#9-repository-structure--navigation)
10. [Repo Hygiene Snapshot at Deprioritization](#10-repo-hygiene-snapshot-at-deprioritization)
11. [Open PRs at Deprioritization](#11-open-prs-at-deprioritization)
12. [Deferred Features & Explicit Non-Goals](#12-deferred-features--explicit-non-goals)
13. [Hard Rules That Still Apply](#13-hard-rules-that-still-apply)
14. [Credentials & Access](#14-credentials--access)
15. [Restart Checklist](#15-restart-checklist)
16. [Open Decisions & Escalation](#16-open-decisions--escalation)

---

## 1. Purpose & Scope

This document is the **single authoritative handoff** for the CAIA Software Factory project as of its 2026-09-05 deprioritization. It covers two repos:

- **`prakashgbid/caia`** — public product monorepo (wizard, chiefaia-site, packages, apps)
- **`prakashgbid/caia-platform`** — private factory infrastructure (caia-slice, control-plane services, reports, migration tools)

**Read this entire document before**:
- Touching any file in either repo
- Reviewing or merging any PR
- Bumping a dependency
- Restarting any service on s903
- Re-engaging any CAIA autonomous agent
- Lifting the factory dispatch kill switch
- Opening new Jira tickets in the CAIA project

**Operator sign-off is required** before resuming feature work. See §16.

---

## 2. TL;DR — State at Pause (2026-09-05)

| Dimension | Status |
|-----------|--------|
| **Overall project** | ⏸️ Paused — deprioritized 2026-09-05 |
| **Kill switch (factory dispatch)** | 🔴 ENGAGED — do not lift (see §5) |
| **Wizard** | 🟢 LIVE — dashboard.chiefaia.com, 9 stages, fully functional |
| **Factory pipeline** | 🟡 PARTIAL — 9/141 SF hardened; has never merged a real PR autonomously |
| **LiteLLM/OpenRouter** | 🟡 UP but stale catalog — see §6 |
| **caia-dispatch-status (CP-16)** | 🟢 LIVE on s903 :9160 |
| **Temporal (CP-01)** | 🟢 LIVE |
| **Kafka (CP-03)** | 🟢 LIVE |
| **Vault (CP-12)** | 🟢 LIVE — root token at `/home/s903/.stolution-vault/vault-root-token-2026-08-24.txt` |
| **caia-jira-bridge** | 🟡 LIVE but mis-wired (all tasks dispatch as `jira_backfill`, not `code_change`) |
| **caia-orchestrator** | 🟡 LIVE but dispatch is a no-op (no slice calls) |
| **caia-slice (s903)** | 🟡 LIVE — SF-00→SF-105 pipeline hardened but kill switch prevents dispatch |
| **chiefaia-wizard.service** | 🟢 systemd, port 7788, Next.js standalone |
| **Caia repo hygiene** | ✅ CLEAN — 0 dirty, 0 stashes, 0 [gone] branches |
| **Caia-platform hygiene** | ✅ CLEAN — 0 dirty, 0 stashes, 0 [gone] branches |
| **Open PRs** | Resolved at deprioritization (see §11) |

**One-sentence summary**: The CAIA wizard is live and polished (9 stages end-to-end), but the autonomous software factory has never produced a real merged PR — it is 14% aligned, kill-switched after a junk-PR incident, and needs 4 prereqs cleared before it can be safely unpaused.

---

## 3. CAIA Architecture Overview

**CAIA** (Composable AI Assembly) = Stolution's canonical software factory.
North star: *"CAIA remembers CAIA, not Claude remembers CAIA."*

### Blueprint reference

- Design doc: `docs/EA/designs/caia-141-microfactory-master-blueprint.md` (in `caia-platform`)
- Jira initiative: [STOL-1034](https://thivaan.atlassian.net/browse/STOL-1034) → upcast to [CAIA-5](https://thivaan.atlassian.net/browse/CAIA-5) after Jira split
- Jira project: CAIA board (id 2, sprint "Sprint-0 Arch & Foundation" id 4, planned 2026-08-24→09-07)

### Structural model

```
141 microfactories (SF-00 .. SF-140)
  + 16 control-plane components (CP-01 .. CP-16)
  = full software factory

Contract per factory: Validated Inputs -> bounded work -> deterministic validation -> versioned outputs -> typed event
```

### 16 Control-Plane Components

| CP | Technology | Status |
|----|-----------|--------|
| CP-01 | Temporal | 🟢 LIVE |
| CP-02 | LangGraph | 🔴 Wave 2 — not started |
| CP-03 | Kafka + CloudEvents | 🟢 LIVE |
| CP-04 | OPA + Kyverno | 🟢 LIVE |
| CP-05 | MinIO + Postgres | 🟢 LIVE |
| CP-06 | Postgres | 🟢 LIVE |
| CP-07 | Apache AGE | 🔴 Wave 2 — not started |
| CP-08 | pgvector + Sentence Transformers | 🔴 Wave 2 — not started |
| CP-09 | LiteLLM | 🟡 LIVE but stale catalog (see §6) |
| CP-10 | MCP aggregator | 🔴 Wave 2 — not started |
| CP-11 | pytest Gate SDK | 🟢 LIVE |
| CP-12 | CF Access + Vault + Firebase | 🟢 LIVE |
| CP-13 | LiteLLM budgets | 🟡 partial — token-tracker /budget/status 404s |
| CP-14 | OTEL + Loki + Tempo + Grafana + Prom | 🟡 LIVE — only 3/17 CAIA services scraped |
| CP-15 | Loki + Postgres + Cosign | 🟢 LIVE |
| CP-16 | caia-dispatch-status | 🟢 LIVE on :9160 |

**Wave 1 kernel** (Epic STOL-1035): CP-01, 03, 04, 05, 09, 11, 14, 15 — ~85% complete.
**Wave 2** (Epic STOL-1046): CP-02, 07, 08, 10, 13 — 0% started. Do not start until kill switch cleared.

### 15 Phase Epics (STOL-1035 through STOL-1049)

STOL-1035 Kernel Wave 1 · STOL-1036 Thin Vertical Slice · STOL-1037 Stage A Vision · STOL-1038 Stage B BI · STOL-1039 Stage C Product · STOL-1040 Stage D-1 Domain · STOL-1041 Stage D-2 Architecture · STOL-1042 Stage E UX · STOL-1043 Stage F Work-Decomp · STOL-1044 Stage G-1 Test Design · STOL-1045 Stage G-2 Code Impl · STOL-1046 Kernel Wave 2 · STOL-1047 Stage H QA+Sec · STOL-1048 Stage I Release+ProdIntel · STOL-1049 Stage J Learning

### Thin vertical slice (the happy path)

```
SF-00 Vision Intake -> SF-06 Feasibility -> SF-65 Bounded Context -> SF-71 Component Spec
  -> SF-82 Test Plan -> SF-91 Code Implementation -> SF-93 Contract Verify
  -> SF-98 Security Scan -> SF-104 Defect Triage -> SF-105 DoD Gate
```

All 9 stages hardened (smoke-tested live in-container). Pipeline has **never** autonomously merged a real PR due to kill switch and unresolved dispatch wiring bugs.

### Important naming note

`prakashgbid/caia` = public product monorepo (wizard, chiefaia-site).
`prakashgbid/caia-platform` = private factory infrastructure.
These are two separate repos — never conflate them.

---

## 4. Live Services & Endpoints

All services run on **s903** (36-core/72-thread Xeon, 503 GB RAM, 7.1 TB NVMe).

### Public-facing

| Service | URL | Notes |
|---------|-----|-------|
| Wizard (Next.js) | https://dashboard.chiefaia.com | 9-stage funnel, live |
| chiefaia.com landing | https://chiefaia.com | chiefaia-site app |
| Factory status | https://dashboard.chiefaia.com/factory | status page |

### Internal / infra

| Service | Port/Path | Notes |
|---------|----------|-------|
| chiefaia-wizard.service | :7788 (systemd) | `sudo systemctl status chiefaia-wizard` |
| LiteLLM (CP-09) | k8s 10.43.255.74:4000, ns stolution-ai | openrouter-* aliases |
| Temporal (CP-01) | https://temporal.stolution.com | |
| Grafana | https://monitor.stolution.com | Prometheus scrapes 3/17 CAIA services |
| MinIO (CP-05) | https://minio.stolution.com | |
| Kafka UI (CP-03) | https://kafka-ui.stolution.com | |
| caia-dispatch-status (CP-16) | :9160 | `GET /tasks/for-operator` |
| caia-jira-bridge | :9120 | polls Jira every 60s |
| caia-orchestrator | :9130 | 5 loops scheduled |
| caia-dod-gate | :9108 | DoD gate v0.1.1 |
| caia-pre-action-check | :9116 | `POST /can-i-do` |
| caia-slice (executor) | /home/s903/caia-platform-worktrees/main/apps/caia-slice/ | 5 replicas, stolution-caia-slice:0.7.0-migrated |
| Vault | :8200 | HTTP AppRole login is the working auth path |
| DB (wizard) | stolution-backstage-postgres:5442, db caia_wizard | |

### Wizard deploy sequence (after a Next.js build)

```bash
cd /home/s903/caia/apps/wizard
cp -r .next/static .next/standalone/apps/wizard/.next/
[ -d public ] && cp -r public .next/standalone/apps/wizard/
sudo systemctl restart chiefaia-wizard
# Env sourced from /etc/chiefaia/wizard.env (has OPENROUTER_API_KEY)
```

---

## 5. Kill Switch — DO NOT LIFT (STOL-6799)

**Status: ENGAGED as of 2026-08-21 09:00 UTC. Do not lift.**

### What happened

On 2026-08-21, caia-slice SF-06 filed a Jira story per run (dedup keyed on run-hash, not component), causing jira-bridge+orchestrator to re-dispatch endlessly. **5,607 junk Jira tickets** created (STOL-1236→STOL-6785) before kill switch engaged.

### 4-layer defense deployed (not fully validated end-to-end in production)

1. **Layer 1** — jira-bridge JQL guard (`NOT labels = runaway-loop-cleanup`)
2. **Layer 2** — SF-06 component-hash dedup (in-container, verified)
3. **Layer 3** — persistent per-hour rate limiter (`_rate_limit_or_raise`, blocks call #4+, cap=3, verified)
4. **Layer 4** — orchestrator loop-detector (`_is_caia_generated`, verified)

The 4 layers passed synthetic tests. However **Attempt 11** (2026-08-22 08:53 UTC) immediately produced 2 duplicate junk PRs within 6 minutes after un-pause — because the STOL-6989 code fix was **not in the deployed image**. Kill switch re-engaged 09:00:16 UTC.

### Prerequisites before lifting (all 4 must be done)

1. Rebuild + redeploy `stolution-caia-slice` from post-stolution-PR-#5692 and post-caia-platform-PR-#48 code (STOL-6989 template-echo fix must be in image)
2. Sync LiteLLM model catalog with `caia-slice/app/llm.py` (stale alias `openrouter-gpt-oss-free` returns HTTP 404)
3. Fix slice replica lease so 5 replicas do not grab the same matrix row simultaneously
4. Commit `apps/caia-self-healer/ops/.env` with CLAUDE_ORCHESTRATOR AppRole pair (prevents 16h silent outage repeat)

**Additionally**: STOL-6801 (kill-switch hardening — durable Postgres-backed, not in-memory) must be implemented before next un-pause attempt.

---

## 6. Known Broken Items (Prioritized)

### P0 — Blocks any factory dispatch

| ID | Issue | Location |
|----|-------|---------|
| STOL-6989 | Template-echo bug: SF-06 generates hardcoded template PRs, not ticket-specific code | stolution-caia-slice:0.7.0-migrated — fix in stolution PR #5692, not yet in deployed image |
| STOL-1174 | LiteLLM catalog stale — `openrouter-gpt-oss-free` 404s (now paid-only) | LiteLLM CP-09, `caia-slice/app/llm.py` |
| STOL-1156 | jira-bridge emits `task_type=jira_backfill` for ALL rows; no handler for `code_change`/`slice_run` | `caia-jira-bridge:9120`, `caia-orchestrator:9130` |

### P1 — Breaks safety guarantees

| ID | Issue | Location |
|----|-------|---------|
| STOL-1178 | caia-token-tracker has no `/budget/status` route (real route: `/budget/weekly`) — every LLM stage cost-cap pre-check 404s silently | caia-token-tracker container |
| STOL-1179 | Prometheus scrapes only 3/17 CAIA services; `caia-factory-pipeline` Grafana dashboard not found | Prometheus scrape config |
| STOL-6801 | Kill-switch hardening — switch is in-memory, not durable | caia-self-healer |

### P2 — Correctness / quality

| ID | Issue | Location |
|----|-------|---------|
| STOL-1177 | caia-platform PRs blocked on self-hosted runner backlog | GitHub Actions runner on s903 |
| STOL-1187 | SF-98 canonical impl is `stolution/apps/caia-slice/app/factories.py`, NOT `caia-platform/factories/sf-98-*` | Design doc reconciliation |
| STOL-1182 | `caia-registry` — no container or source exists; covered by decision-registry + Backstage | Blueprint amendment |
| STOL-1176 | Pre-existing red CI on stolution main blocks PR #2367 (first factory-produced PR) | stolution monorepo CI |

### P3 — Operational debt

- `python/caia-ai-decision-sdk/dist-new/` — root-owned build artifact in caia-platform. Excluded via `.git/info/exclude`. When convenient, delete it with elevated privileges: `sudo rm -r /home/s903/caia-platform/python/caia-ai-decision-sdk/dist-new/`.
- `wip/stash-1-prakash-website-pre-vision` in caia — push blocked by GitHub pre-receive hook. Content: `services/slot-manager/catalog-info.yaml` + `services/sps/catalog-info.yaml`. Push manually with a `chore(...)` commit from a fresh terminal session.
- caia-token-tracker and caia-pre-action-check containers are LIVE but have **no source in git** (only `__pycache__`) — STOL-1178.

---

## 7. Factory Pipeline State

### Hardening status (as of 2026-08-22)

| Stage | What it does | Hardened? |
|-------|-------------|-----------|
| SF-00 | Vision Intake — scores ticket for factory readiness | ✅ 2026-08-22 |
| SF-06 | Feasibility — rejects too-large / too-vague tickets | ✅ 2026-08-22 |
| SF-65 | Bounded Context — domain classification | ✅ 2026-08-22 |
| SF-71 | Component Spec — ticket-specific specs | ✅ 2026-08-22 |
| SF-82 | Test Plan — per-file test specs | ✅ 2026-08-22 |
| SF-91 | Code Implementation — free-tier OpenRouter ladder | ✅ (via SF-82 path) |
| SF-93 | Contract Verify | ✅ (thin slice) |
| SF-98 | Security Scan + a11y + CWV evidence | ✅ deployed 2026-08-21 |
| SF-104 | Defect Triage | ✅ 2026-08-22 |
| SF-105 | DoD Gate | ✅ 2026-08-22, v0.1.1 (bug fixed: CONTROL_PLANE type now gates correctly) |

**Remaining**: 132 microfactories (SF-01..64, SF-66..70, SF-72..81, SF-83..90, SF-92, SF-94..97, SF-99..103, SF-106..140) — 0% hardened.

### Alignment score (2026-08-21)

- **Overall alignment: 13.7%** (157 stages: 141 SF + 16 CP)
- SHIPPED: 5 | PARTIAL: 26 | STUB: 19 | MISSING: 107 | HARDENED: **0**
- Full report: `caia-platform/reports/2026-08-21-caia-alignment-matrix.md`
- Rerun weekly: `python3 scripts/alignment/gen_alignment_matrix.py`

### Throughput

- Theoretical structural: 720 PRs/hr
- **Actual: 0 PRs** — dispatcher routes all work to `jira_backfill` (no-op)

### E2E wiring gaps (STOL-1156 — Highest priority)

1. Bridge emits `task_type=jira_backfill` for every row — all succeed as no-ops, `pr_url` NULL on all 640 succeeded rows
2. No `code_change`/`slice_run` handler in agent-worker — never calls `caia-slice /api/runs`
3. Orchestrator DoD loop only snapshots matrix — never calls caia-dod-gate, never transitions Jira
4. `matrix-jira-syncer` adds `matrix-planned` label but `transition=None` — never moves ticket to Done
5. SF-98 evidence emit — `stolution-evidence-store:8085/api/v1/evidence` returned 404 (correct path is `/evidence`, not `/api/v1/evidence`)

### LiteLLM MODEL_LADDER (working state as of 2026-08-22)

```python
FREE_LADDER = [
    "openrouter-nemotron-super-free",   # reliable, <2s
    "openrouter-gemma-free",            # proven workhorse
    "openrouter-glm-free",              # transient 429s
    # REMOVED: openrouter-gpt-oss-free  (OpenRouter moved to paid)
]
```

Purpose-keyed routing: `opus-5` (elite reasoning) · `claude-sonnet-4-6` (strong) · `gpt-4o-mini` (cheap short) · `perplexity/sonar-pro` (web search) · `gemini-2.5-pro` (large context) · `haiku-4.5` (cheapest fast)

---

## 8. Wizard — dashboard.chiefaia.com

### What it is

A 9-stage MVP-builder wizard. Runs as `chiefaia-wizard.service` (systemd, port 7788) on s903, Next.js 15.5.18 standalone.

### 9 Stages

1. **Onboarding** — project name + idea entry
2. **Grand Idea** — voice-to-text, idea refinement via AI chat
3. **Interview** — smart follow-up questions
4. **Information Architecture** — real IA generation
5. **Proposal** — full proposal with initiatives/epics/stories
6. **Landing Page** — AI-generated HTML5 landing page (iframe, sandboxed)
7. **Log In** — mock OAuth (grants 100-token LOGIN_REWARD), email/password auth backend
8. **Build the MVP** — split-screen Sandpack live preview with per-screen code generation
9. **Subscribe** — $9.99/mo or $59.99/yr toggle

### Token economy (`apps/wizard/lib/session/tokens.ts`)

Starting balance 50. LOGIN_REWARD 100. Per-stage costs: onboarding:0, grand-idea:3, interview:8, architecture:10, proposal:15, landing:14, login:0, build:25, subscribe:0. The 50-token starter deliberately runs out at stage 6 to force login gate.

Backend: Postgres `caia_wizard` DB on stolution-backstage-postgres:5442. Session uses `caia:session-change` CustomEvent for reactive UI updates.

### Sandpack + Tailwind pattern (DO NOT reinvent)

Inject Tailwind via side-effect import from custom `/index.js` → `/tw-loader.js`.
Do NOT inject via `/public/index.html` — Sandpack's `react` template silently overrides it.
See `apps/wizard/app/wizard/stages/BuildPanel.tsx`.

### Startup documents system

14 doc types generated by `lib/docs/catalog.ts`: Executive Summary, Business Plan, Pitch Deck, One-Pager, Financial Model, GTM Plan, ICP/Personas, Competitive Analysis, PRD, Roadmap, Tech Architecture, Brand Guidelines, Legal/IP, KPI Dashboard.

Generator: `POST /api/wizard/docs/generate` (gpt-4o-mini short, mistralai/mistral-nemo long-form).
Viewer: `/wizard/docs` and `/wizard/docs/[id]`.

### Common components (`apps/wizard/components/common/`)

`StageExplainer` · `InputExplainer` · `ProcessLoader` · `AiFailurePanel` · `VoiceInput` (Web Speech API) · `ViewportSelector` (Phone/Tablet/Desktop) · `MarkdownRender` · `MvpTreePanel` · `DesignPicker`

Note: `VoiceInput` built but not placed in all textareas. `ProcessLoader`/`AiFailurePanel` exist but panels still use own spinners. `DesignPicker` built but not placed in any stage.

### Recent wizard sprint history

| PR | Summary |
|----|---------|
| [#782](https://github.com/prakashgbid/caia/pull/782) | Sidebar guard + enriched-MVP auto-fire + IA JSON repair + roadmap founder-friendly |
| [#781](https://github.com/prakashgbid/caia/pull/781) | Projects landing + resume-on-return + upsertDoc + Docs cleanup |
| [#780](https://github.com/prakashgbid/caia/pull/780) | Pivot detection + coverage accumulates + coach role + docs-unlocked banners |
| [#779](https://github.com/prakashgbid/caia/pull/779) | Sprint 3 deferred — real IA + WYSIWYG + revisions + Save-and-exit + resume |
| [#778](https://github.com/prakashgbid/caia/pull/778) | Sprint 3 — smart-question idea refiner + real chat UI + MvpBreakdownGrid |
| [#777](https://github.com/prakashgbid/caia/pull/777) | Value Sprint 2 — deployable MVP screens with router + real .pptx and .xlsx |
| [#776](https://github.com/prakashgbid/caia/pull/776) | Value Sprint 1 — model routing table + real research + investor-grade docs |
| [#773](https://github.com/prakashgbid/caia/pull/773) | Canonical ProjectSpec + Design stage + email/password auth + real-time voice |
| #765/#764/#763/#762 | Phases D/C/B/A overnight batch |
| [#761](https://github.com/prakashgbid/caia/pull/761) | MVP flow phases 3-7: 9-stage funnel with Sandpack Build + Subscribe |

---

## 9. Repository Structure & Navigation

### `prakashgbid/caia` (public monorepo)

```
apps/
  wizard/          <- Next.js 15.5.18, dashboard.chiefaia.com (:7788)
  chiefaia-site/   <- Next.js, chiefaia.com landing (NOT a separate repo)
packages/
  ui/              <- @caia/ui shared components
  billing/         <- @caia/billing (stub mode)
docs/
  HANDOFF.md       <- THIS FILE
  EA/designs/      <- caia-141-microfactory-master-blueprint.md
  adr/             <- Architecture Decision Records
  pause-state-2026-07-08.md  <- previous pause (focus shift to Stolution)
```

Branch model: `develop` (default, gitflow enforced) + `main`
Pre-commit hook: blocks direct commits to `develop`
Pre-receive hook: enforces conventional commit types (rejects `wip(...)`, accepts `feat(...)`, `fix(...)`, `chore(...)`)

### `prakashgbid/caia-platform` (private factory infra)

```
apps/
  caia-slice/          <- Main factory executor (SF-00->SF-105)
                          Deploy source: /home/s903/caia-platform-worktrees/main/apps/caia-slice/
                          Image: stolution-caia-slice:0.7.0-migrated
  caia-self-healer/
  caia-jira-bridge/    <- :9120
  caia-orchestrator/   <- :9130
  caia-dod-gate/       <- :9108, v0.1.1
  caia-dispatch-status/ <- :9160 (CP-16)
  caia-token-tracker/  <- :9116 (use /budget/weekly not /budget/status)
python/
  caia-ai-decision-sdk/  <- dist-new/ root-owned (excluded via .git/info/exclude)
  caia-platform-client/  <- caia_platform.dispatch_status installed editable
tools/
  migration/           <- caia_migrate_jira.py + caia_migrate_conf.py
  subagent-preamble.md <- CP-16 registration prompt block
reports/               <- Detailed session reports (authoritative)
  2026-08-21-caia-weekly-architecture-review.md
  2026-08-21-caia-alignment-matrix.md
  split-exec-20260821/keymap-jira.json    <- Jira migration rollback map
  split-exec-20260821/keymap-confluence.json
scripts/
  alignment/gen_alignment_matrix.py
```

Branch model: `main` (default)
Active worktrees: `dod-gate-deploy` · `feat/stol-1094-litellm-delegation-pattern` · `fix/stol-1178-token-tracker-budget-status` · `fix/stol-6799-jira-bridge-vault-client-dep` · `merge-stol-1094-to-main`
Remote: `https://github.com/prakashgbid/caia-platform.git` (HTTPS — SSH deploy key was broken)

---

## 10. Repo Hygiene Snapshot at Deprioritization

All 6 checkouts audited and cleaned on 2026-09-04.

### Mac repos

| Repo | Path | Status |
|------|------|--------|
| caia (Cursor) | `/Users/MAC/Cursor Projects/caia` | ✅ CLEAN — main, no local work |
| caia (VSCode) | `/Users/MAC/VS Code Projects/caia` | ✅ CLEAN — main, no local work |
| caia-platform | — | N/A — not present on Mac |
| chiefaia-site | — | N/A — lives inside caia monorepo |

### s903 repos

| Repo | Branch | dirty | stashes | [gone] | worktrees | Result |
|------|--------|-------|---------|--------|-----------|--------|
| `/home/s903/caia` | develop | 0 | 0 | 0 | 1 | ✅ CLEAN |
| `/home/s903/caia-platform` | main | 0 | 0 | 0 | 6 | ✅ CLEAN |

### Key hygiene actions taken

**s903/caia:**
- Removed 7 prunable worktrees (dirs already deleted from disk)
- Deleted 15 [gone] local branches — all pushed to `origin/preserved/` first
- Deleted 14 additional local branches — all pushed to origin under own names
- Promoted 3 stashes to wip/ branches, pushed to origin
- Moved `apps/chiefaia-site/.next.rollback/` to `/home/s903/scratch/caia-build-artifacts/`

**s903/caia-platform:**
- Changed remote from broken SSH deploy key to HTTPS
- Committed all 163 untracked items into `wip/pre-deprioritize-2026-09-04-caia-platform` and `preserved/feat/stol-1162-or-delegate-sdk` — both pushed
- Deleted 21 [gone] local branches — all pushed to `origin/preserved/`
- Promoted 2 stashes to wip/ branches, pushed to origin
- Removed 8 worktrees for [gone] branches; 6 clean worktrees remain
- `python/caia-ai-decision-sdk/dist-new/` (root-owned) added to `.git/info/exclude`

### Unresolved WIP

| Item | Details |
|------|---------|
| `caia: wip/stash-1-prakash-website-pre-vision` | Push blocked by GitHub pre-receive hook. Content: `services/slot-manager/catalog-info.yaml` + `services/sps/catalog-info.yaml`. Push manually with valid conventional commit from fresh terminal. |
| `caia-platform: dist-new/` | Root-owned build artifact at `python/caia-ai-decision-sdk/dist-new/`. Delete with elevated privileges when convenient. |
| `caia-token-tracker` + `caia-pre-action-check` | LIVE containers but no source in git (only `__pycache__`). STOL-1178. |

---

## 11. Open PRs at Deprioritization

### caia (`prakashgbid/caia`)

| PR | Title | Decision | Reason |
|----|-------|----------|--------|
| [#793](https://github.com/prakashgbid/caia/pull/793) | [draft] fix/rr3-cold-start-timeout-2026-05-15 | **Closed** | Draft, conflicting, May 2026, stale |
| [#792](https://github.com/prakashgbid/caia/pull/792) | [draft] fix/rr2-intent-vocab-mismatch-2026-05-15 | **Closed** | Draft, conflicting, May 2026, stale |
| [#791](https://github.com/prakashgbid/caia/pull/791) | [draft] fix/gc1-be-terse-preamble-2026-05-15 | **Closed** | Draft, conflicting, May 2026, stale |
| [#775](https://github.com/prakashgbid/caia/pull/775) | fix(wizard): stop AtlasWizardClient re-rendering forever | **Deferred** | Real fix, project paused — pick up at restart |
| [#740](https://github.com/prakashgbid/caia/pull/740) | [draft] feature/billing-byok-2026-05-25 | **Deferred** | BYOK billing is planned feature (§12) — start fresh at restart |

### caia-platform (`prakashgbid/caia-platform`)

| PR | Title | Decision | Reason |
|----|-------|----------|--------|
| [#35](https://github.com/prakashgbid/caia-platform/pull/35) | STOL-6995 dod-gate: docs-only PRs require no runtime test evidence | **Merged** | Clean correctness fix, MERGEABLE |
| [#32](https://github.com/prakashgbid/caia-platform/pull/32) | fix(caia-token-tracker): add /budget/status endpoint (STOL-1178) | **Merged** | Fixes P1 known-broken item STOL-1178 |

---

## 12. Deferred Features & Explicit Non-Goals

### Per [[deferred-physical-tenant]] (HARD RULE 2026-08-26)

Physical tenant provisioning (Incus/LV/Vault/Keycloak) deferred to post-payment. Pre-payment = single CAIA-owned CMS with row-level tenancy.

### Per [[deferred-post-launch]]

Stripe TEST mode and Strapi bootstrap parked until 200 daily visitors.

### Wizard-specific non-goals (current)

- Real OAuth (Google/Apple/email verification) — post-MVP
- Real Stripe / payment provisioning — post-MVP
- Backend persistence of session tokens (currently localStorage-only) — post-MVP
- Actual project ZIP export (currently text stub) — post-MVP
- PDF viewer component — markdown only
- PPTX viewer — pitch deck is markdown outline, not a real .pptx
- New-project flow with "login later" — no login modal on click
- AI cache wired into API routes — module exists (`lib/ai/cache.ts`), callers do not use it
- Text validation wired into existing forms — module exists (`lib/validate/text.ts`), forms do not call it
- VoiceInput placed in all textareas — component exists, not universally placed
- ProcessLoader / AiFailurePanel adoption in existing panels
- Phase E (continuing SF loop past payment) — not started

### BYOK billing (real planned feature — deferred)

Per [[byok-first-ai]]: BYOK path = $4.99–9.99/mo. CAIA-provided path = tokens at cost + 15–20% markup. PR #740 is a May 2026 draft — start fresh at restart from current develop.

### Wave 2 CPs (STOL-1046) — do not start

CP-02 LangGraph, CP-07 Apache AGE, CP-08 pgvector, CP-10 MCP aggregator, CP-13 LiteLLM budgets (tickets STOL-1136..1155). Start only after kill switch cleared and first real PR merged.

---

## 13. Hard Rules That Still Apply

| Rule | Summary |
|------|---------|
| **OpenRouter Only** | ALL CAIA AI calls route via OpenRouter — customer flows AND orchestrator. No Claude Max, no Anthropic direct. |
| **Browser-Test First** | NEVER claim UI work done from HTTP 200 alone. Real browser interaction, screenshot each step, file Jira per bug. |
| **No Standby Between Iterations** | During multi-hour authorized sessions, do NOT send "standing by / ready" messages. Just continue. |
| **Ship Don't Plan** | No new sprint planning until existing stories ship end-to-end at chiefaia.com. |
| **chiefaia.com Is The Brand** | All CAIA user-facing work deploys to chiefaia.com. Do not deploy to caia.stolution.com. |
| **Self-Review And Merge** | Self-review + self-merge own PRs. No operator review gates for tech work. |
| **All Credentials In Vault** | NEVER hardcode. Fetch at runtime. Vault AppRole (claude-orchestrator) is the standard auth path. |
| **No Human In Loop** | Prefer upfront-effort + one-time cost over recurring human steps. |
| **No Temporary Work** | Never stopgap solutions. Always long-term + reliable. |
| **Cost Sign-off Required** | Check with operator before any new cost (SaaS, SMS, GCP, domain, etc.). |
| **Solve Once Remember Forever** | Every solved problem → memory + code + docs. |
| **DoD Hard Rule** | caia-dod-gate (:9108) gates transitions/merges/SF-105. PRs without passing gate do not merge. |
| **PR Lifecycle** | PRs created + merged within 30 min, branches deleted. Enforced by caia-pr-lifecycle-guard. |
| **Supreme Sudo** | s903 user has full NOPASSWD sudo via `/etc/sudoers.d/s903-full-sudo`. Never ask operator for sudo. |

---

## 14. Credentials & Access

### Key locations

| Secret | Location |
|--------|----------|
| Vault root token | `/home/s903/.stolution-vault/vault-root-token-2026-08-24.txt` |
| Vault AppRole (claude-orchestrator) | Vault `secret/caia/prod/dispatch-status` + caia-orchestrator container env |
| Atlassian PAT | Vault `secret/data/stolution/prod/atlassian` field `api_token` |
| OPENROUTER_API_KEY | `/etc/chiefaia/wizard.env` + Vault |
| CF Access service token | Vault `secret/stolution/prod/cf-access-service-token` |
| Google OAuth CF Access | Vault `secret/stolution/prod/google-oauth-cf-access` |
| caia-dispatch-status DB | Vault `secret/caia/prod/dispatch-status`, DB `caia_dispatch_status` |

### Access paths

- **Vault HTTP**: `http://s903:8200` — use AppRole login, not `docker exec` (Docker migration broke `setns fork/exec`)
- **SSH to s903**: CF Zero Trust JWT auth, 24h TTL — `ssh -T` not `-tt`
- **caia-platform remote**: `https://github.com/prakashgbid/caia-platform.git` (HTTPS — SSH deploy key was broken)
- **s903 sudo**: NOPASSWD, no password needed (`/etc/sudoers.d/s903-full-sudo`)

### Jira / Confluence split keymap (rollback path)

- Jira keymap: `/home/s903/caia-platform/reports/split-exec-20260821/keymap-jira.json`
- Confluence keymap: `/home/s903/caia-platform/reports/split-exec-20260821/keymap-confluence.json`
- Each migrated Jira ticket labeled `migrated-to-caia:<CAIA-KEY>` and cross-linked

### CAIA-specific databases

- Wizard: `caia_wizard` on stolution-backstage-postgres:5442
- Alignment matrix: `caia_alignment` (queryable: `alignment.stage_status`)
- Dispatch status: `caia_dispatch_status` on stolution-backstage-postgres

---

## 15. Restart Checklist

**Before touching anything, re-read this document end-to-end.** Then:

### Phase 0 — Verify live state (before any code changes)

- [ ] Confirm wizard is still live: `curl https://dashboard.chiefaia.com/wizard/onboarding`
- [ ] Confirm chiefaia-wizard.service is running: `sudo systemctl status chiefaia-wizard`
- [ ] Confirm kill switch is still engaged — DO NOT lift without completing Phase 1
- [ ] Confirm Vault is accessible: `curl http://localhost:8200/v1/sys/health`
- [ ] Check repo hygiene in both repos: `git status --porcelain=v1 | wc -l` (expect 0)

### Phase 1 — Fix kill-switch prerequisites (before lifting)

- [ ] **[P0] Fix STOL-6989**: Rebuild `stolution-caia-slice` from post-stolution-PR-#5692 code. Tag: `stolution-caia-slice:0.7.1` or higher.
- [ ] **[P0] Fix STOL-1174**: Update LiteLLM catalog — remove `openrouter-gpt-oss-free`, verify current free-tier aliases valid.
- [ ] **[P0] Fix slice replica lease**: Ensure 5 replicas cannot grab the same matrix row simultaneously.
- [ ] **[P0] Commit caia-self-healer env**: Write CLAUDE_ORCHESTRATOR AppRole pair to `apps/caia-self-healer/ops/.env`.
- [ ] **[P1] Implement STOL-6801**: Durable Postgres-backed kill switch.

### Phase 2 — Fix factory E2E wiring (STOL-1156)

- [ ] Fix jira-bridge to emit `task_type=code_change` for eligible tickets (not `jira_backfill`)
- [ ] Add `code_change`/`slice_run` handler to agent-worker → calls `caia-slice /api/runs`
- [ ] Wire orchestrator DoD loop to call caia-dod-gate and transition Jira tickets
- [ ] Fix `matrix-jira-syncer` to transition ticket state to Done

### Phase 3 — Observability (before un-pausing)

- [ ] Fix Prometheus to scrape all 17 CAIA services (STOL-1179)
- [ ] Confirm `caia-factory-pipeline` Grafana dashboard is live on monitor.stolution.com
- [ ] Deploy caia-token-tracker with `/budget/status` endpoint (caia-platform PR #32 merged — confirm it is deployed)

### Phase 4 — First real dispatch test (controlled)

- [ ] Pick 1 low-risk ticket labeled `AI-ready` from CAIA backlog
- [ ] Un-pause kill switch
- [ ] Watch for 10 minutes — confirm no duplicate PRs, no junk tickets
- [ ] If clean: let run for 30 min, confirm at least 1 real PR opened on correct repo
- [ ] Re-engage kill switch, evaluate, iterate

### Phase 5 — Resume feature work (operator sign-off required)

- [ ] Re-read §12 (deferred features) before scoping any new work
- [ ] Re-read §13 (hard rules) before writing any code
- [ ] Pick up deferred PRs: caia #775 (AtlasWizardClient fix), #740 (BYOK billing — start fresh from develop)
- [ ] Run alignment matrix: `python3 scripts/alignment/gen_alignment_matrix.py`
- [ ] Update `MEMORY.md`: change DEPRIORITIZED section to reflect active status

---

## 16. Open Decisions & Escalation

### 5 Open decisions from blueprint §13 (awaiting operator ratification)

1. **Temporal OSS vs n8n for CP-01** — Recommendation: Temporal + keep n8n for glue
2. **Apache AGE vs Neo4j Community for CP-07** — Recommendation: AGE (stays on Postgres, $0)
3. **Redpanda vs existing Kafka for CP-03** — Recommendation: keep Kafka
4. **Monorepo layout**: `apps/caia-*` + shared `apps/caia-sdk/`
5. **Naming**: `CAIA` (platform) + `SF-##` (numbered microfactories)

### Pending operator actions (pre-deprioritization)

1. Merge or reject [stolution PR #2367](https://github.com/prakashgbid/stolution/pull/2367) — first factory-produced PR, open since 2026-08-20
2. Ratify the 5 blueprint §13 decisions above
3. Approve Kernel Wave 2 kickoff ([STOL-1046](https://thivaan.atlassian.net/browse/STOL-1046))
4. Review Sprint-0 plan (CAIA-145..148, 26 stories, 89 pts) — created 2026-08-23, awaiting approval

### CP numbering inconsistency (resolve before new CP-## tickets)

Two parallel numbering systems exist in this codebase. Reconcile in design doc before filing more CP-## tickets. Use service names in Jira tickets as workaround. Tracker: [STOL-1182](https://thivaan.atlassian.net/browse/STOL-1182).

### Escalation

**Operator**: prakashgbid (GitHub), prakashmailid@gmail.com
**Before any action**: read this document, then ping the operator via Discord (chiefaia INFO channel).

---

*HANDOFF.md generated 2026-09-05 by Claude (claude-sonnet-4-6) from memory files: caia_master_blueprint.md, caia_launched.md, wizard_mvp_flow_shipped.md, wizard_overnight_2026_08_27.md, MEMORY.md (recent hard-rules section), and repo hygiene audit completed 2026-09-04.*
