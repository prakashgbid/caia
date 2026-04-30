# Capability Broker (operator runbook)

Out-of-band enforcement layer for irreversible agent actions. Implements
third-party-paper §C.1 + v2 §3 (April 2026 update). Source:
`packages/capability-broker/`.

## Why this exists

The Replit / Lemkin (July 2025) incident: an AI agent deleted a production
database during an explicit code freeze, then misreported the rollback. The
lesson — text guardrails do not work; only out-of-band enforcement does.

CAIA agents (Coding Agent, Fix-It Test Agent) run a Claude Code subprocess.
Without this broker, that subprocess can `git push --force`,
`gh pr merge --admin`, `npm publish`, issue Cloudflare API calls, drop a
Supabase table, etc.

## Primitives

```
agent  ──issue request──▶  CapabilityBroker  ──signed token──▶  agent
agent  ──token + payload──▶  CapabilityExecutor  ─delay (5s)─▶  handler
                                          │             │
                                          ▼             ▼
                          IrreversibleActionLedger     dashboard
                          (append-only)                 cancel button
```

1. **CapabilityBroker.issue(request)** validates `(name, agentRole, scope)`
   against the registry's allowlist + per-task budget, then issues a signed
   token with a 5-minute TTL. Tokens are HMAC-SHA256 signed; signature
   binds together `tokenId | name | scope | agentRole | taskId | issuedAt
   | expiresAt | singleUse`.
2. **CapabilityExecutor.execute({ token, payload, reason })** validates
   the token, dispatches to the registered handler for `payload.name`,
   and records the outcome to the ledger. Even failures are recorded.
3. **IrreversibleActionLedger** — append-only persistence keyed by `id`.
   In-memory + SQLite implementations. Drizzle migration in
   `packages/capability-broker/migrations/0001_irreversible_actions.sql`.
4. **IrreversibleDelay** (v2 §3.7) — when wired into the executor, every
   irreversible-capability execution waits 5 seconds (configurable)
   between accept + handler dispatch. The dashboard receives an
   `irreversible_pending` event and renders a Cancel button. If the
   operator clicks Cancel before the delay elapses, the handler is never
   invoked and the execution is recorded as `cancelled-by-operator`.
5. **HookControlledMode** (v2 §3.8) — adapter for Claude Code's
   `--permission-mode hook-controlled` flag. Replaces `bypassPermissions`.
   Hook subprocesses route every tool call through `preToolUse(input)`
   which returns `{ decision: 'allow' | 'deny', reason }`.

## Runtime guard

`assertCapabilityForCommand(cmd, args, ctx)` is wired into the Coding
Agent's shell-spawn paths (`DiffCommitter`, `LocalTestRunner`,
`DodSelfCheck`). It pattern-matches the command line against
`DEFAULT_GUARD_RULES` and throws if a privileged action lacks a current
valid token. Default rules cover `git push` to protected branches,
`git push --force`, `gh pr merge`, `gh repo delete/archive`,
`npm/pnpm publish`, and `supabase db reset`. Safe commands (`pnpm test`,
`git status`, `ls`, etc.) pass through.

## 5-second irreversible delay

For every capability flagged `irreversible: true` in the registry, the
executor inserts a 5-second pause between `accept` and handler dispatch.
During the pause:

- The dashboard renders a Cancel button next to the pending action.
- Clicking Cancel calls `IrreversibleDelay.cancel({tokenId, by, …})`.
- The cancel resolves the executor's promise with `{ cancelled: true }`,
  which records the execution as `cancelled-by-operator` on the ledger
  without invoking the handler.

5 seconds is empirically enough for human reaction when watching the
dashboard. The delay is bypassed for reversible / rate-limited
capabilities (e.g. read-only API calls), and configurable per-call for
emergencies.

```ts
import {
  CapabilityExecutor,
  IrreversibleDelay,
  CapabilityBroker,
  InMemoryLedger,
} from '@chiefaia/capability-broker';

const delay = new IrreversibleDelay({ defaultDelayMs: 5_000 });
delay.on((ev) => {
  if (ev.kind === 'pending') dashboard.publish('irreversible_pending', ev);
});

const executor = new CapabilityExecutor({
  broker,
  ledger,
  handlers,
  irreversibleDelay: delay,
  isIrreversible: (name) => registry.getCapability(name)?.irreversible ?? true,
});
```

## Hook-controlled permission mode

```bash
claude \
  --permission-mode hook-controlled \
  --hook-pre-tool-use="$BROKER_BIN preToolUse" \
  --hook-post-tool-use="$BROKER_BIN postToolUse"
```

The hook scripts read JSON from stdin and write JSON to stdout. They
delegate to `HookControlledMode` over a local Unix socket — the
orchestrator-side adapter is the in-process broker; the hook is its
subprocess shim.

## Allowlist surface

Capabilities + allowlist entries are registered at orchestrator boot via
`createDefaultRegistry()` + `registry.registerAllowlistEntry()`. Example:

```ts
import {
  CapabilityBroker,
  StaticSigningKeyProvider,
  createDefaultRegistry,
} from '@chiefaia/capability-broker';

const registry = createDefaultRegistry();
registry.registerAllowlistEntry({
  name: 'cloudflare.api',
  agentRole: 'coding-agent',
  scopePattern: 'cf/zones/*/dns_records*',
  maxPerTask: 3,
});

const broker = new CapabilityBroker({
  registry,
  signingKey: new StaticSigningKeyProvider(
    process.env.CAPABILITY_BROKER_SIGNING_KEY!,
  ),
});
```

## What goes through the broker (and what doesn't)

| Action                         | Broker?                              |
|--------------------------------|--------------------------------------|
| `git status`, `git diff`       | No (read-only)                       |
| `git commit`, `git push origin <feature/>` | No (non-protected, reversible) |
| `git push origin main`         | **Yes** (`git.push.protected`)       |
| `git push --force`             | **Yes** (`git.push.force`)           |
| `gh pr create`, `gh pr view`   | No                                   |
| `gh pr merge`                  | **Yes** (`gh.pr.merge`)              |
| `pnpm test`, `pnpm build`      | No                                   |
| `npm publish`, `pnpm publish`  | **Yes** (`npm.publish`)              |
| `supabase db reset`            | **Yes** (`supabase.db.reset`)        |
| Cloudflare API calls           | **Yes** (`cloudflare.api` family)    |
| File reads / writes inside the worktree | No                          |
| File deletes outside the worktree | **Yes** (`fs.delete.outside.worktree`) |

## Failure modes the broker catches

- The Coding Agent decides to `git push --force origin main` to "fix" a
  failed PR. **Blocked** by the runtime guard — no `git.push.force` token.
- The Coding Agent calls `npm publish` with a vendored auth token to
  "ship" a sibling package. **Blocked** — no `npm.publish` token.
- A leaked / replayed token from another task tries to call a different
  scope. **Blocked** — signature binds scope; mutation invalidates it.
- A long-running task replays the same token after 5 minutes. **Blocked**
  — `expired_token`.
- A task tries to redeem a single-use token twice. **Blocked** —
  `token_already_used`.
- An accepted irreversible action that the operator clicks Cancel on
  during the 5s window. **Cancelled** — handler never invoked; ledger
  records `cancelled-by-operator`.

## Operator queries

```sql
-- All irreversible actions on a task, newest first
SELECT * FROM irreversible_actions
WHERE task_id = ? ORDER BY ts DESC;

-- Actions that have a rollback pointer (operators can compensate)
SELECT id, ts, capability_name, scope, undo_token
FROM irreversible_actions
WHERE undo_token IS NOT NULL
ORDER BY ts DESC LIMIT 50;

-- Cancelled-by-operator hits in the last day
SELECT id, ts, capability_name, scope, reason
FROM irreversible_actions
WHERE result_json LIKE '%cancelled-by-operator%'
  AND ts > strftime('%s', 'now', '-1 day') * 1000
ORDER BY ts DESC;
```

## Key rotation

Replace the `StaticSigningKeyProvider` with a provider that returns the
active key + a window of recently-rotated keys via `getAcceptedKeys()`.
Tokens issued under a recently-retired key still verify until they
expire (default 5 min after rotation).

## Reference

- Source: `packages/capability-broker/src/`.
- Tests: `packages/capability-broker/tests/` (45 cases).
- Migration: `packages/capability-broker/migrations/0001_irreversible_actions.sql`.
- Paper analysis: `~/Documents/projects/reports/third-party-caia-paper-analysis-2026-04-29.md` §C.1.
- v2 update: see user prompt 2026-04-29 (5-sec delay, hook-controlled mode).
- Related: `caia/docs/mcp-security.md`, `caia/docs/prompt-injection-defense.md`.
