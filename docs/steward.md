# Steward Gatekeeper — operator runbook

The Steward Gatekeeper is the permanent enforcement layer for the 15
recurring failure modes catalogued in the 2026-04-26 → 2026-05-04
chaos / hygiene / release-blocker / Vault / orphan-branch sweep. It is
the source of truth for code, release, deployment, builds, and platform
discipline going forward.

This runbook is the operator-facing reference: what each check enforces,
what each alert means, how to respond, and how to extend with new checks.

**Status:** Phases 1, 2a, 2b shipped. Phases 2c–2f and full Phase 3
deferred — see §10 "What's not in this runbook (yet)" for the queue.

## 1. What ships today

| Component | Role |
|---|---|
| `@chiefaia/steward-core` (PR #285) | Predicate-evaluable engine for process YAMLs (currently propose-only). |
| `@chiefaia/steward-analyzers` (PR #291, #292) | Static analyzers for pre-merge checks. Three live: `migration-linter`, `migration-numbering`, `graph-divergence`. |
| `.github/workflows/steward-gatekeeper.yml` | Three jobs: `steward-gatekeeper-{migration-linter,migration-numbering,graph-divergence}`. Currently all `continue-on-error: true` (warn-only first cycle). |
| `agent/memory/steward_gatekeeper_directive.md` | Standing directive codifying the 15 failure modes + Steward's enforcement scope. |
| `~/Documents/projects/reports/steward-gatekeeper-architecture-2026-05-04.md` | Full architecture spec; this runbook is the abridged operational view. |

## 2. The 15 failure modes — current enforcement state

| # | Failure mode | Surface | Severity | Status |
|---|---|---|---|---|
| 1 | Drizzle multi-statement migration without `--> statement-breakpoint` | pre-merge | block | **shipped** (`migration-linter`) |
| 2 | Release back-merge graph divergence | pre-merge | block (release) / medium (other) | **shipped** (`graph-divergence`) |
| 3 | Migration numbering collision / gap | pre-merge | block (collision) / medium (gap) | **shipped** (`migration-numbering`) |
| 4 | Stash accumulation (count > 0) | daily + pre-spawn | medium / high | queued (Phase 2c) |
| 5 | Orphan branches without open PR (age > 7d) | daily | medium / high | partially via existing `hygiene-report.yml`; Phase 2c extends |
| 6 | Worktree count > 8 (warn) / > 12 (block-spawn) | daily + pre-spawn | medium / high | queued (Phase 2c) |
| 7 | Backup pipeline silent failure | daily | high | partially via existing `com.stolution.vault-snapshot-pull`; Phase 2d extends |
| 8 | Audit log unbounded growth | daily | medium | resolved via existing rotation cron; Phase 2d adds Steward visibility |
| 9 | Token expiry approaching | weekly | medium / high | queued (Phase 2d) |
| 10 | PRs stale > 14d (warn) / > 30d (auto-close) | daily | medium / action | partially via existing `hygiene-report.yml`; queued for full coverage |
| 11 | Dependabot DIRTY > 30 days | weekly | medium / high | deferred (next campaign) |
| 12 | Memory index drift > 10% | weekly | medium | deferred (next campaign) |
| 13 | Subscription bucket exhaustion approaching | daily | medium / high | deferred (next campaign — needs 7d spend history) |
| 14 | CI flake masquerading as real failure | weekly | medium / high | deferred (next campaign — needs CI history accumulation) |
| 15 | MCP transport saturation | continuous + pre-spawn | medium / high | deferred (next campaign — needs stable signal source) |

Severity legend:
- **block**: pre-merge check fails non-zero, blocks PR merge once promoted from `continue-on-error`
- **high**: dashboard alert + dedicated tracking issue opened
- **medium**: dashboard alert + appended to the daily Git Hygiene issue
- **low**: recorded only

## 3. Architecture — three integration surfaces

```
                          Steward Gatekeeper
                          ├─────────────────────────────────────┐
                          │                                       │
   PR opened              │            Cron tick                  │   Pre-spawn hook
       │                  │                │                      │         │
       ▼                  │                ▼                      │         ▼
┌─────────────────┐       │       ┌──────────────────┐            │  ┌──────────────┐
│ steward-       │        │       │ GitHub Actions   │            │  │ steward      │
│ gatekeeper.yml │        │       │ cron + Mac       │            │  │ preflight    │
│  (CI workflow) │        │       │ launchd          │            │  │  (CLI)       │
└────────┬────────┘       │       └────────┬─────────┘            │  └──────┬───────┘
         │                │                │                      │         │
         ▼                │                ▼                      │         ▼
       SHIPPED                            QUEUED                       QUEUED
```

The pre-merge surface is shipped today (workflow + 3 analyzers). The
cron and pre-spawn surfaces are queued — they need the daemon-side
adapter work in the existing P1 PR queue before they can fire reliably.
Until those land, daily/weekly checks stay manual or on existing crons
(`hygiene-report.yml`, vault-snapshot-pull LaunchAgent, audit-log
rotation cron).

## 4. Operating recipes

### 4.1 — A `steward-gatekeeper-*` check failed on my PR

Open the failed job's logs. Each finding is logged with format:

```
::error file=apps/orchestrator/src/db/migrations/0037_x.sql,line=17::[migration-linter/multi-statement-without-breakpoint] Migration has 4 top-level statements but only 0 `--> statement-breakpoint` markers (need at least 3).
```

The `[analyzer/ruleId]` prefix tells you which check fired. Common
remediations:

| ruleId | Remediation |
|---|---|
| `migration-linter/multi-statement-without-breakpoint` | Insert `--> statement-breakpoint` between each pair of statements. See PR #287 for the canonical fix shape. |
| `migration-numbering/duplicate-prefix` | Either delete the orphan file (if not in journal) or rename one to the next free prefix. |
| `migration-numbering/numbering-gap` | If intentional, add a noop placeholder. Otherwise investigate (likely a branch dropped/renumbered without journal update). |
| `graph-divergence/develop-main-merge-base-stale` | Run `pnpm flow back-merge` (or manually open `chore/back-merge-main-into-develop-YYYY-MM-DD` PR per `feedback_git_flow_enforced.md`). |

If a check is wrong (false positive), open a PR fixing the analyzer at
`packages/steward-analyzers/`. Do **not** bypass with `--no-verify` /
`--admin` / disabling the workflow.

### 4.2 — Promoting a check from warn-only to required

When a check has been clean for one full release cycle (the existing
PRs all pass it after offender cleanup), promote in two steps:

1. Edit `.github/workflows/steward-gatekeeper.yml` — remove
   `continue-on-error: true` from the relevant job.
2. Edit `caia/scripts/setup-branch-protection.sh` — add the job's
   context name to `REQUIRED_CONTEXTS_JSON`.
3. Run `bash scripts/setup-branch-protection.sh all` to apply.

Standard pattern; matches Evidence Gate's lighthouse/axe/visual
promotion path.

### 4.3 — Adding a new analyzer

1. Add `src/<analyzer-name>.ts` exporting an `analyze(input)` function
   that returns `Finding[]`.
2. Re-export from `src/index.ts`.
3. Add tests at `tests/<analyzer-name>.test.ts` (positive + negative
   + adversarial cases minimum).
4. Add a subcommand in `bin/steward-gatekeeper.mjs`.
5. Add a job in `.github/workflows/steward-gatekeeper.yml` (start
   `continue-on-error: true`).
6. Update §2 of this runbook.
7. Update `agent/memory/steward_gatekeeper_directive.md` if it's a new
   failure mode (vs an extension of an existing one).

### 4.4 — A new failure mode appears in production

1. Write the incident up at `~/Documents/projects/reports/<failure-mode>-<date>.md` with:
   - Pattern observed (what broke, when, recovery steps)
   - Signal (what data Steward could read to detect this)
   - Threshold (when does Steward fire)
   - Severity (warn / block / action)
   - Response (which surface — pre-merge / daily / weekly / pre-spawn)
2. Ship the analyzer per §4.3.
3. Update the failure-mode table (§2) and `agent/memory/steward_gatekeeper_directive.md`.

## 5. Local pre-flight (before pushing)

Run any analyzer locally to preview before pushing:

```bash
# All three current analyzers
node packages/steward-analyzers/bin/steward-gatekeeper.mjs all

# Or individually
node packages/steward-analyzers/bin/steward-gatekeeper.mjs migration-linter
node packages/steward-analyzers/bin/steward-gatekeeper.mjs migration-numbering
node packages/steward-analyzers/bin/steward-gatekeeper.mjs graph-divergence
```

Exit code 0 = no block-severity findings; exit 1 = blocked. Output
includes GHA-format annotations (so the same output is useful in CI).

For the test suite:

```bash
pnpm --filter @chiefaia/steward-analyzers test
```

## 6. Standing rules (codified in `agent/memory/steward_gatekeeper_directive.md`)

1. **Steward Gatekeeper is the gatekeeper.** Decisions about code,
   release, deployment, builds, and platform that fall within the 15
   enumerated failure modes default to whatever Steward enforces.
2. **The 15 checks are the canonical set as of 2026-05-04.** New
   failure modes either fit one of the existing checks (extend) or
   get added to the directive + new check shipped via the same PR
   pattern.
3. **Pre-merge `steward-gatekeeper-*` checks are required.** Once
   branch protection is updated (Phase 3), no PR merges to develop or
   main without them green. No "small" exception per
   `feedback_definition_of_done.md`.
4. **Pre-spawn hook is mandatory** for substantial-work spawns
   (codifies `feedback_operational_discipline.md`).
5. **Drift observations live in `smart_cicd_observations`** with
   bucket `steward_*` per the BucketName extension shipped in PR #285.
6. **Auto-close is the only auto-modifying behaviour** (PRs > 30d not
   labelled `keep-open`). All other recovery actions remain
   operator-only until P5 actor lands.
7. **No API key spend.** Per `feedback_no_api_key_billing.md`, any LLM
   reasoning goes through `@chiefaia/local-llm-router` (claude binary
   or Ollama).

## 7. Where Steward writes its observations

- **Pre-merge findings:** GHA annotations in the PR's Files-Changed
  view + workflow logs. Block-severity findings make the job exit 1.
- **Daily/weekly findings (when Phase 2c+ ships):** `smart_cicd_observations`
  table with bucket prefix `steward_*`. Surfaces in dashboard
  `/operations` (extension to existing surface).
- **Tracking issues:** extends the existing `Git Hygiene — YYYY-MM-DD`
  issue (per `hygiene-report.yml`) for daily summary; opens dedicated
  `Backup Pipeline Down`, `Token Rotation`, `Dependabot Triage`
  issues for ongoing-incident classes.

## 8. Reference

- Architecture: `~/Documents/projects/reports/steward-gatekeeper-architecture-2026-05-04.md`
- Memory directive: `agent/memory/steward_gatekeeper_directive.md`
- Predecessor design (engine + 8-PR queue): `~/Documents/projects/reports/devops-steward-agent-design-2026-05-03.md`
- Predecessor PR (engine): #285
- Phase 2a PR (this campaign): #291
- Phase 2b PR (this campaign): #292
- Final campaign report: `~/Documents/projects/reports/steward-gatekeeper-shipped-2026-05-04.md`
- Source: `caia/packages/steward-analyzers/`, `caia/packages/steward-core/`
- Workflow: `.github/workflows/steward-gatekeeper.yml`
- Existing related workflows: `.github/workflows/{evidence-gate,gitflow-conformance,hygiene-report,auto-pr,secrets-scan}.yml`

## 9. The 0037 collision (live offender as of 2026-05-04)

`migration-numbering` flags this on every PR run:

```
BLOCK: 0037 prefix collision:
  apps/orchestrator/src/db/migrations/0037_irreversible_actions.sql (orphan, not in journal)
  apps/orchestrator/src/db/migrations/0037_story_capsule.sql (registered)
```

The `0037_irreversible_actions.sql` file is on disk but not registered
in `meta/_journal.json`. The orchestrator never applies it; the
production database has whatever schema `0037_story_capsule.sql`
created. The orphan file's intended schema (the
`irreversible_actions` table for the Capability Broker ledger) is
provided by `packages/capability-broker/migrations/0001_irreversible_actions.sql`
and works through that path. Cleanup PR will delete the orphan.

The workflow's `continue-on-error: true` means this finding does not
block PRs today. Once cleanup lands and the check is promoted to
required, the live develop will be clean.

## 10. What's NOT in this runbook (yet)

These are queued for follow-up campaigns. The architecture doc has
full check definitions; the directive has the standing-rule wording.

- **Phase 2c — daily hygiene checks (failure modes 4, 5, 6):**
  stash count, orphan-branch cumulative count, worktree-cap.
  Implementation: extends `hygiene-report.yml` + adds Mac-side
  launchd `com.caia.steward.daily` for filesystem-local checks +
  `steward preflight` CLI for the pre-spawn hook.
- **Phase 2d — backup-pipeline + token-expiry (failure modes 7, 8, 9):**
  weekly Mac launchd `com.caia.steward.weekly` reading vault
  `*_expires_at` fields via `mcp__stolution-remote__stolution_vault_*`.
- **Phase 2e — staleness + dependabot + memory-drift (failure modes 10, 11, 12).**
- **Phase 2f — flake + saturation + spend-predict (failure modes 13, 14, 15).**
- **Full Phase 3 — branch protection update + cron/launchd install
  + remaining doc updates.**

The next campaign continues from this runbook's §10. The cleanup PR
for the live `0037` collision is independent and can ship any time.
