# Spend Guard (operator runbook)

Programmatic Anthropic-spend cap with hard auto-pause + serial
account-pool fallback. Implements third-party-paper §C.4 + v2 §6 +
Prakash 2026-04-30 update (multi-account default).

Source: `packages/spend-guard/`.

## Why

The Phase 2 acceptance suite envisions 8-hour-plus autonomous runs.
Without a programmatic cap, a degenerate prompt or a broken routing
rule could burn through the Anthropic budget before anyone notices.
The 2025 incident reports show this is a recurring failure mode for
unattended agent pipelines.

## Default caps (v2 §6.4)

| Scope          | Default cap | Reset cadence |
|----------------|-------------|----------------|
| `task`         | $1.50       | daily          |
| `project`      | $30         | weekly         |
| `global-day`   | $25         | daily          |
| `global-week`  | $100        | weekly         |

Override per-deployment by passing `caps` to the `SpendGuard`
constructor. The defaults are also exported as `DEFAULT_CAPS_USD`.

## Hard auto-pause

The first pre-flight that would breach `global-day` flips
`pauseState.paused = true`. Every subsequent `preFlight()` throws a
`BudgetExceededError` until an operator calls `guard.resume(by)` (CLI
`pnpm spend resume` or the dashboard "Resume" button).

Per-task and per-project breaches throw `BudgetExceededError` but do
not auto-pause — the orchestrator continues other tasks while one task
is over budget. Only the global-day cap pauses the whole pipeline.

## Account-pool fallback (Prakash 2026-04-30 update)

Default `mode = 'multi'` with two accounts. Serial fallback chain:

```
account-2 → account-1 → API key (sticker rate)
```

No parallel arbitrage. The `AccountPool` rotates through configured
accounts and falls through to API key when every subscription account
is exhausted / rate-limited / suspended.

The ToS-fragility warning fires once at startup (Anthropic's Feb 2026
enforcement disabled ~1.45M multi-account users in H2 2025) but is
informational, not blocking. Flip to single-account mode in seconds:

```bash
ANTHROPIC_ACCOUNT_POOL_MODE=single   # use only the first account
ANTHROPIC_ACCOUNT_POOL_MODE=api-fallback   # bypass pool, sticker rate
```

The dashboard widget renders:
- Active account
- Weekly cap remaining per account
- Last-rotation timestamp
- ToS-warning badge when `mode = 'multi'` + `accountCount > 1`

If/when an account gets suspended, the visible badge tells the
operator immediately, and the `mode=single` switch lets them recover
without code changes.

## local-llm-router preference

`SpendGuard.dailySpendPctOver(pct)` returns true when daily spend is
≥ `pct` of the cap (default 80%). The local-llm-router consults this
on every routing decision — when daily spend > 80% of cap, the router
shifts marginal-complexity requests to Ollama instead of Claude.

```ts
import { SpendGuard } from '@chiefaia/spend-guard';

if (await guard.dailySpendPctOver(0.8)) {
  // 80% of daily cap reached — bias to local Ollama for everything
  // not explicitly model-locked by the routing rules.
  return routeToOllama();
}
```

## Schema

`packages/spend-guard/migrations/0001_spend_caps.sql` provisions:

- `spend_caps` (PK: `(scope, resource_id)`) — one row per cap; updated
  in-place by the guard's increment path. SQLite `INSERT OR IGNORE`
  semantics for the create-on-first-use pattern.
- `spend_records` — append-only spend events. `via` is one of
  `subscription`, `api-key`, `ollama`. Includes `account_id` so the
  dashboard can attribute spend by account.

The orchestrator's drizzle schema mirrors this DDL (follow-up PR).

## Wiring

Pre-flight (before every Anthropic API call):

```ts
await guard.preFlight({
  taskId: 'task-123',
  projectId: 'pokerzeno',
  estimatedUsd: estimateRequestCostUsd({ model, promptTokens, maxOutputTokens }),
});
```

Record (after the response returns):

```ts
await guard.record({
  taskId: 'task-123',
  projectId: 'pokerzeno',
  agentRole: 'coding',
  model: 'claude-sonnet-4-6',
  via: 'subscription',
  accountId: 'acct-prakash-1',
  inputTokens: usage.input_tokens,
  outputTokens: usage.output_tokens,
  costUsd: computeCostUsd(model, usage),
});
```

Pool routing (before issuing the request):

```ts
const decision = pool.route({ estimatedUsd });
// decision.via === 'subscription' | 'api-key'
// decision.accountId === string | null
// → forward the request via the chosen path
pool.applySpend({ accountId: decision.accountId!, usd: realCostUsd });
```

## Dashboard surface

- Always-visible spend counter in the dashboard nav showing today's
  USD vs cap.
- "/spend/accounts" page rendering the `AccountPool.snapshot()` in a
  table.
- "/spend/history" page rendering `spend_records` filtered by task /
  project / via.
- Pause banner with the breach reason + Resume button when
  `pauseState.paused = true`.

## Tests (`pnpm --filter @chiefaia/spend-guard test`)

28 vitest cases:
- `tests/cost.test.ts` — 7 (input/output rates, cache pricing, default
  fallback).
- `tests/spend-guard.test.ts` — 9 (per-task / per-project / global-day
  / pause / resume / period reset / ollama bypass / 80% threshold).
- `tests/account-pool.test.ts` — 12 (multi / single / api-fallback,
  fallback chain, rotation events, ToS warning, suspended/rate-
  limited accounts, snapshot).

## Reference

- Source: `packages/spend-guard/src/`.
- Tests: `packages/spend-guard/tests/`.
- Migration: `packages/spend-guard/migrations/0001_spend_caps.sql`.
- Paper analysis: `~/Documents/projects/reports/third-party-caia-paper-analysis-2026-04-29.md` §C.4.
- v2 update: see user prompt 2026-04-29 (default caps + ToS warning).
- 2026-04-30 update: account-pool default reverts to `multi` with 2
  accounts (paid-for capacity, ToS-warning informational only).
- Related: `caia/docs/capability-broker.md`, `caia/docs/mcp-security.md`.
