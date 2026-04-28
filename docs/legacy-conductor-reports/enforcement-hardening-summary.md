# Enforcement Hardening Summary

**Branch:** `enforce/memory-hardening-v1`  
**Date:** 2026-04-22T06:09:49Z  
**Build:** 2–4h implementation pass converting memory rules → mechanical guardrails

---

## Numbers

| Metric | Count |
|--------|-------|
| Total rules inventoried | 357 |
| Converted to mechanical enforcement | 47 |
| Tagged advisory (judgment-based) | 98 |
| Enforcement gaps documented | 212 |
| Violations found during implementation | 2 (P0 blockers filed) |
| New gates added to build-runner | 3 |
| New pre-commit gate additions | 2 |
| Contract tests written | 69 |
| Contract test files | 5 |
| Dashboard page created | 1 (`/enforcement`) |
| CI workflow created | 1 (`gate:memory-rule-enforceable`) |
| DB migration created | 1 (0013) |

---

## Violations Found During Implementation (K=2)

### V-001 — DOM-001 Trigger Blocked 53 Tests (P0 BLOCKER)
- **Rule:** DOM-001 — every entity must have domain tags
- **Violation:** 53 existing test fixtures insert tasks without `domain_slug`
- **Action:** DOM-001 DB trigger deferred; blocker `BL-DOM001-FIXTURE-BACKFILL` filed
- **Deferred enforcement:** test fixture backfill required across 6 test files

### V-002 — HEALTH-009 NOT NULL Too Aggressive (P0 BLOCKER)
- **Rule:** HEALTH-009 — zero tasks with null `root_prompt_id`
- **Violation:** `executor-routes.test.ts` + `priority-routes.test.ts` (29 fixtures) insert tasks without `root_prompt_id`
- **Action:** Downgraded from NOT NULL to DEFAULT 'untraced'; partial enforcement
- **Partial enforcement:** `schema.ts` `.default('untraced')` ensures new ORM inserts get the default; NOT NULL deferred until test backfill

---

## New Enforcement Mechanisms

### Pre-commit Hook Additions (`.githooks/pre-commit`)

| Gate | Rule | What it checks |
|------|------|----------------|
| `gate:no-env-writes` | SEC-052 | Blocks staging `.env*` files |
| `gate:decision-autonomy` | AUTON-001 | Scans staged TS/JS for banned phrases in string literals |

### Build-Runner Gates Added (`scripts/build-runner.sh`)

| Gate | Rule | Status |
|------|------|--------|
| `gate:supply-chain` | SEC-050 | Active — `npm audit --production --audit-level=high` |
| `gate:a11y` | ACCESS-035 | Stub — requires `@axe-core/playwright` install to activate |
| `gate:brand-lock` | POKE-001 | Stub — activates in pokerzeno repo |

### Runtime Middleware (`apps/orchestrator-middleware/`)

New package with three enforcement modules:

| Module | Rules | What it enforces |
|--------|-------|-----------------|
| `banned-phrases.ts` | AUTON-001/002/006/007/008 | Scans outbound messages for 12 forbidden patterns |
| `task-run-logger.ts` | TASK-001/002/003/004 | Tracks task spawns, detects missing `task_run_record` calls |
| `prompt-creator.ts` | TRACE-001/002/003/009 | Ensures `prompt_create` is called before decomposition; deduplicates by hash within 10s |

Exports `createOrchestrationGuard()` factory combining all three.

### DB Migration (`src/db/migrations/0013_health009_dom001.sql`)

- Backfills `tasks.root_prompt_id = 'untraced'` for all NULL rows
- Rebuilds tasks table with `root_prompt_id TEXT DEFAULT 'untraced'` (HEALTH-009 partial)
- Recreates all 6 task indexes
- DOM-001 trigger deferred (see V-001 above)

**Schema change:** `src/db/schema.ts` — added `.default('untraced')` to `rootPromptId` field so Drizzle ORM uses the default on new inserts.

### Contract Tests (`tests/contracts/`)

| File | Contract | Tests |
|------|----------|-------|
| `banned-phrases.contract.test.ts` | AUTON-001/002/006/007/008 | 19 |
| `task-run-logger.contract.test.ts` | TASK-001 | 10 |
| `prompt-creator.contract.test.ts` | TRACE-001/002/003 | 14 |
| `pre-commit-gate.contract.test.ts` | SEC-052 | 16 |
| `orchestration-guard.contract.test.ts` | Integration | 10 |
| **Total** | | **69 tests** |

All 69 tests pass. Full suite: **535/535 pass**.

### Enforcement Dashboard (`dashboard/app/enforcement/`)

New page at `/enforcement` showing:
- KPI cards: total / enforced / advisory / gap / violations-7d
- Mechanism breakdown bar chart
- Most-violated rule leaderboard
- Searchable/filterable full rule table with status badges

Added to dashboard nav (`dashboard/app/layout.tsx`).

### CI Meta-Enforcement (`.github/workflows/memory-rule-enforceable.yml`)

Runs on every PR touching `.auto-memory/**/*.md`:
1. Extracts new rule lines containing imperative keywords
2. Fails merge if `reports/memory-rule-inventory.md` was not updated
3. Fails merge if `advisory: true` is set without `advisory_reason`

Local script: `scripts/check-memory-rule-enforceable.sh`

### Advisory Tagging

Two fully-advisory memory files tagged:
- `away_mode.md` — `advisory: true` (operational tone/silence protocol)
- `learnings.md` — `advisory: true` (operational judgment learnings, no static analysis possible)

---

## Rule Inventory

Full inventory at `reports/memory-rule-inventory.md`

**By mechanism:**

| Mechanism | Count |
|-----------|-------|
| build-runner-gate | 14 |
| pre-commit-hook | 6 |
| runtime-middleware | 8 |
| db-constraint | 2 (partial) |
| contract-test | 5 |
| daemon | 4 |
| advisory | 98 |
| gap (implementation deferred) | 212 |

**By source file (top gaps):**

| File | Total | Enforced | Advisory | Gap |
|------|-------|----------|----------|-----|
| accessibility_lock.md | 45 | 1 | 0 | 44 |
| secrets_hyper_security.md | 55 | 8 | 0 | 47 |
| pipeline_pulse_utility.md | 40 | 0 | 40 | 0 |
| learnings.md | 53 | 0 | 53 | 0 |
| away_mode.md | 12 | 0 | 12 | 0 |
| decision_autonomy.md | 11 | 4 | 1 | 6 |
| task_run_log_protocol.md | 12 | 4 | 0 | 8 |
| prompt_traceability.md | 9 | 3 | 0 | 6 |

---

## Dashboard

`/enforcement` page available when dashboard is running at `http://localhost:7777/enforcement`.

No screenshot path available (dashboard not running in this session).

---

## New Gates List

```
gate:no-env-writes     (pre-commit)
gate:decision-autonomy (pre-commit)
gate:supply-chain      (build-runner, active)
gate:a11y              (build-runner, stub — activate with axe-core)
gate:brand-lock        (build-runner, stub — activates in pokerzeno repo)
gate:memory-rule-enforceable (CI — runs on .auto-memory PR changes)
```
