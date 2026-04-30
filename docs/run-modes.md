# Run modes — plan-only and test-only

Status: shipped 2026-04-30 (migration `0038_run_mode`).

Every prompt submitted to CAIA is a **run**. A run mode controls how far down the pipeline a run goes. There are three modes:

- **`full`** — the default. The full Phase-1 + Phase-2 pipeline runs: PO + BA + EA + Validator + Test-Design + Task Manager + Coding Agent + Fix-It (if needed). Code is written, tests are run, PRs are opened.
- **`plan-only`** — the decomposition pipeline runs (PO + BA + EA + Validator + Test-Design + Task Manager) and stories reach `bucket_placed` / `ready_for_pickup`, but no worker is ever assigned. The output is the WorkGraph + per-story `architecturalInstructions[]` + estimated tokens / cost. No file writes, no PRs. Useful for "what would CAIA do with this prompt — and how much would it cost?" preview.
- **`test-only`** — the full pipeline runs, including the Coding Agent, but the per-run capability allowlist is restricted before the Context Capsule is frozen. Deploy / publish / push-main capabilities are stripped: `git_push_main`, `cloudflare_pages_deploy_*`, `supabase_migration_apply`, `npm_publish`. Code is written and tested in a worktree but never deployed or shipped. Useful for "show me what the implementation would look like, but don't go live yet."

The single source of truth for the mode list and the per-mode behaviour is `apps/orchestrator/src/run-modes/index.ts`.

## How to invoke

### Dashboard

The submit form has three buttons:

- **Run full →** — default behaviour, equivalent to the historical "Submit to your AI team".
- **Run plan only — show me the cost** — submits with `runMode=plan-only`.
- **Run test only — code but don't deploy** — submits with `runMode=test-only`.

After submission, fetch `/api/prompts/<id>/plan-output` to render the plan and cost breakdown.

### CLI

The `@chiefaia/cli` package now exposes:

```
caia plan "Build a feature for X"
caia test "Refactor the auth flow"
```

Both accept `--api`, `--project`, and `--priority` flags. The CLI POSTs to the orchestrator's `/prompts` endpoint with the corresponding `run_mode` field.

### HTTP API

```
POST /prompts
Content-Type: application/json

{
  "body": "Build a feature for X",
  "received_via": "api",
  "run_mode": "plan-only"
}
```

`run_mode` is optional. If absent, the orchestrator defaults to `full`. Unknown values are 400'd at the API boundary so callers learn about typos immediately rather than silently falling back.

## What's enforced where

| Concern | Enforced in | Notes |
|---|---|---|
| Run mode is recorded on the prompt | `prompts.run_mode` (migration 0038) | `NOT NULL DEFAULT 'full'` |
| Run mode is denormalised onto every story | `stories.run_mode` (migration 0038) | Inherited from the prompt at PO Agent story-creation time. |
| Plan-only runs never reach a worker | `ReadyPoolConsumer.pump()` | The SQL `WHERE` clause filters `run_mode != 'plan-only'`. |
| Test-only runs have restricted capabilities | Capability Broker (Track 1) | Until the broker lands, the orchestrator emits the run-mode in the `ticket.capsule-frozen` event for downstream consumers. |
| Run-mode validation | `POST /prompts` | 400 with the canonical mode list on unknown values. |

## Cost estimation

`estimateRunCost(mode, storyIds)` in `run-modes/index.ts` returns a rough-cut estimate of input + output tokens and USD cost (Sonnet-class pricing). The per-agent token figures are deliberate approximations; the dashboard renders them with a "± rough estimate" caveat. Refine as actual telemetry from `executor_runs.tokens_in/out` accumulates.

The estimate excludes Coding Agent + Fix-It tokens for `plan-only` runs (they don't run); they are included for `test-only` and `full`.

## Cross-references

- **Context Capsule (PR #207, migration 0037)** — the per-story Context Capsule is what the Coding Agent verifies on pickup. The capsule's `tool_allowlist` slice is the input to the capability allowlist that test-only runs strip. Drift between the freeze (test-only-restricted) and pickup (full allowlist read) is detectable as a `capsule-drift` blocker.
- **Capability Broker (Track 1, in flight)** — the broker reads `stories.run_mode` and applies `restrictAllowlistForMode()` before any tool call. Until it lands, test-only enforcement is plumbing-level (event signalling) rather than hard-blocked.
- **Spend-cap auto-pause (PR #206, HARDEN-011)** — orthogonal to run modes. Spend-cap halts a run independent of mode if the per-run dollar cap is exceeded.
- **Evidence Gate (PR #200, §C.2)** — runs after the Coding Agent. Plan-only runs never reach the gate; test-only and full do.

## Operational notes

Default behaviour for every existing prompt + every in-flight prompt is unchanged. The migration adds the column with `DEFAULT 'full'`, so prompts created before this change carry `run_mode='full'` and follow the historical path.

The denormalised `stories.run_mode` column is what the consumer reads — the join to `prompts` is intentionally avoided in the hot path.

To audit how many runs of each mode have shipped:

```sql
SELECT run_mode, COUNT(*) FROM prompts GROUP BY run_mode;
```
