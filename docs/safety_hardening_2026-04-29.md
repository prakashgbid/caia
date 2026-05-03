# Safety Hardening — 2026-04-29 → 2026-04-30

Operator memory file capturing the Track-1 Safety Hardening work and the
2026-04-30 orchestrator-side wireup that closed the original
"What this does NOT cover yet" caveat.

## Scope

Track 1 (2026-04-29) shipped four packages as libraries:
  - `@chiefaia/capability-broker` — out-of-band enforcement for irreversible actions.
  - `@chiefaia/mcp-allowlist-proxy` — MCP spawn allowlist + sandbox-exec.
  - `@chiefaia/tool-output-sanitizer` — prompt-injection scrubber.
  - `@chiefaia/spend-guard` — daily / weekly / per-task / per-project caps.

Track 2 (2026-04-30) wired those libraries into the orchestrator's
runtime path. This file is the post-Track-2 status.

## Wireup landed (2026-04-30)

| PR  | Branch                                             | Subject |
|-----|----------------------------------------------------|---------|
| #231 | `feat/safety-001-broker-orchestrator-wireup`      | Replace `bypassPermissions` with `--permission-mode hook-controlled`; in-process broker socket server + hook subprocess (`caia-broker-hook`) shipped from `@chiefaia/capability-broker`'s bin. |
| #232 | `feat/safety-002-mcp-spawn-wrapper`               | Wrap every MCP entry the orchestrator registers in `~/.claude/mcp.json` through `buildSandboxedSpawn` (sandbox-exec on Darwin, allowlist + public-bind guards everywhere). |
| #233 | `feat/safety-003-tool-result-sanitization`        | Bridge from `@chiefaia/tool-output-sanitizer` to (a) the orchestrator's MCP-server outbound tool results and (b) the broker's `HookControlledMode.postToolUse` plug-in. Per-source strictness: `paranoid` for web fetches, `lenient` for vendored MCPs. |
| #234 | `feat/safety-004-spend-cap-orchestrator`          | DB tables `spend_caps` + `spend_records` (migration 0040). SQLite-backed `CapStore` + `RecordSink`. `SpendGuardBridge` exposing `preFlight` / `record` / `pauseState` / `resume`. HTTP routes `GET /spend/today`, `POST /spend/resume`. AccountPool default = 2 (multi) with serial fallback. |

Release PR develop → main: **#235**, branch `release/2026-04-30-broker-wireup`.

## Final state

- `apps/executor/dispatcher.ts` calls `buildClaudeArgs()` which augments
  the claude argv with `--permission-mode hook-controlled
   --hook-pre-tool-use=<bin>  preToolUse
   --hook-post-tool-use=<bin> postToolUse` and injects
  `CAIA_BROKER_SOCKET / CAIA_BROKER_TASK_ID / CAIA_BROKER_AGENT_ROLE`
  env vars so the spawned hook subprocess can find the broker server.
- `apps/orchestrator/src/install.ts`'s `installMcpConfig()` writes
  sandbox-wrapped MCP entries (`/usr/bin/sandbox-exec -f
  scripts/mcp-sandbox.sb -- node server.js`).
- `apps/orchestrator/src/mcp/server.ts`'s `toolResult()` runs every
  outbound payload through `sanitizeOutboundMcpResult`.
- `apps/orchestrator/src/safety/spend-guard-bridge.ts` is the surface
  for `/llm/route` preFlight + record (the call-site update in
  `api/routes/llm.ts` is a one-line follow-up; bridge is wired and
  tested).
- DB schema default for `executor_config.permission_mode` is now
  `hook-controlled` (migration 0039 + schema.ts default).

## What this does NOT cover yet

(none — the integration items below were closed by the 2026-04-30 wireup.)

~~Removed: every "What this does NOT cover yet" item from the original
2026-04-29 memo that referenced orchestrator integration is now done.~~

Outstanding Track-3 follow-ups (not Track-1 scope, separate PRs):
  - Pump-side `BudgetExceededError → runs.status = 'paused-budget' +
    emit run.paused.budget event` — bridge surface ready, one
    call-site change.
  - `pnpm caia spend resume` CLI — bridge surface ready.
  - Dashboard widget for `/spend/today` — endpoint live.
  - Tightening the broker policy mapper (`p0ToolToCommand`) past the P0
    "allow everything" default.
  - `conductor harden-mcps` CLI to migrate operator-edited
    `~/.claude/mcp.json` entries through `wrapMcpConfig`.

## Verification (2026-04-30)

- `pnpm typecheck` — green across 47 workspace projects.
- `@chiefaia/capability-broker` tests — 45 pass.
- `apps/executor` SAFETY-001 vitest tests — 7 pass (broker integration
  argv augmentation, allow path, deny path, irreversible path,
  audit-log surface, hook timeout, hook crash recovery).
- `apps/orchestrator` SAFETY-002/003/004 vitest tests via
  `pnpm test:safety` — 32 pass (MCP wrap × 8, sanitizer bridge × 12,
  spend-guard bridge × 12).
- Broker socket smoke test: hook subprocess connects to socket, sends
  preToolUse frame, receives `{decision: "allow"}` on the P0 default.
- `0040_spend_caps.sql` migration applies cleanly via drizzle's
  better-sqlite3 migrator (statement-breakpoint markers added after
  initial CI feedback).

## Pointers

- Source — `packages/capability-broker/src/`,
  `packages/mcp-allowlist-proxy/src/`,
  `packages/tool-output-sanitizer/src/`,
  `packages/spend-guard/src/`,
  `apps/executor/broker-integration.ts`,
  `apps/orchestrator/src/safety/`,
  `apps/orchestrator/src/mcp/sandboxed-mcp-config.ts`.
- Docs — `caia/docs/capability-broker.md` (operator runbook),
  `caia/docs/mcp-security.md`, `caia/docs/spend-guard.md`,
  `caia/docs/prompt-injection-defense.md`.
- Migrations — `apps/orchestrator/src/db/migrations/0039_executor_hook_controlled.sql`,
  `apps/orchestrator/src/db/migrations/0040_spend_caps.sql`.
