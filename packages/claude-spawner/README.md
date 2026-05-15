# @chiefaia/claude-spawner

Unified subscription-only `claude` binary spawner for the CAIA monorepo.

## Why this package exists

Before D1 (2026-05-15), seven packages each maintained their own
`child_process.spawn(...)` / `spawnSync(...)` wrapper around the
`claude` binary:

- `@chiefaia/verifier`            (`src/agent.ts` `defaultRunChild`)
- `@chiefaia/code-reviewer`       (`src/llm-reasoner.ts`)
- `@chiefaia/critic`              (`src/llm-reasoner.ts`)
- `@chiefaia/reviewer`            (`src/llm-reasoner.ts`)
- `@chiefaia/apprentice-eval`     (`src/judge.ts` `runProcess`)
- `@chiefaia/apprentice-corpus`   (`src/distiller.ts`)
- `@chiefaia/researcher`          (`src/llm-client.ts`)

Each independently scrubbed env vars, set timeouts, sized buffers,
built argv, and parsed JSON envelopes. Drift was inevitable — a fix in
one (e.g. new auth-token scrub, larger maxBuffer for synthesis) never
propagated to the others. The integration-remediation plan §D Phase D1
called for extracting the canonical pattern from
`@chiefaia/local-llm-router`'s `claude-adapter.ts` into a stand-alone
package — this is that extraction.

## Hard constraint — subscription-only

The pay-per-token Anthropic API path is **FORBIDDEN** per
`feedback_no_api_key_billing.md` (Prakash 2026-04-30). This package:

- **Always** scrubs `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, and
  the other LLM-vendor key env vars from the child's env before
  spawning.
- Provides an opt-in `rejectIfApiKeyPresent` constraint that throws
  before the spawn if the calling process has any of those vars set
  (useful for orchestrators that want a loud diagnostic when an
  operator's shell leaks an API key).
- **Never** falls back to API-key billing on failure — failures surface
  as `ok: false` with a diagnostic; callers route around with local
  Ollama via `@chiefaia/local-llm-router`'s cascade rules.

## Usage

```ts
import { spawnClaude, parseClaudeJsonEnvelope } from '@chiefaia/claude-spawner';

const result = await spawnClaude({
  prompt: 'Summarise the following diff…',
  options: {
    model: 'claude-sonnet-4-6',
    timeoutMs: 60_000,
    permissionMode: 'bypassPermissions',
  },
  constraints: {
    cwdAllowList: ['/home/user/repo'],
  },
});

if (!result.ok) {
  // Log result.diagnostic and fall through to local Ollama, etc.
} else {
  const parsed = parseClaudeJsonEnvelope(result.stdout);
  if (parsed.ok) {
    console.log(parsed.text);
  }
}
```

## What this package does NOT do

- It does **not** ship a CLI entrypoint. That's the A2 work
  (file-disjoint per the integration plan).
- It does **not** classify rate-limit errors. Callers that need that
  taxonomy should keep using `@chiefaia/local-llm-router`'s
  `ClaudeAdapter`, which layers `ClaudeRateLimitedError` on top.
- It does **not** decide when to fall back to local Ollama. That's the
  router's job.
- It does **not** manage account rotation. That's the
  `spend-guard` / `account-pool` job. The package does honour
  `homeOverride` so callers can point at a different credentials dir
  per spawn.

## Constraints reference

| Constraint                | Default | Behaviour                                                                 |
| ------------------------- | ------- | ------------------------------------------------------------------------- |
| `rejectIfApiKeyPresent`   | `false` | Throws `SpawnClaudeConstraintError` if any `*_API_KEY` env var is set.   |
| `cwdAllowList`            | none    | Throws if resolved cwd is not under any path in the list.                |

## Migration notes

Migrating callers from the ad-hoc spawn wrappers should follow this shape:

1. Add `"@chiefaia/claude-spawner": "workspace:*"` to `dependencies`.
2. Replace the local `spawn(...)` / `spawnSync(...)` call with
   `await spawnClaude({ prompt, options })`.
3. Replace local stdout-envelope parsing with `parseClaudeJsonEnvelope(...)`.
4. Keep your test seam — `options.spawnFn` lets you inject a mock spawn.

The `local-llm-router` package's `ClaudeAdapter` is **deliberately**
left untouched in D1 — it carries the rate-limit taxonomy plus account
attribution that the seven ad-hoc sites didn't need, and migrating it
would force every account-rotation code path to re-thread errors.

## See also

- ADR: `docs/EA/decisions/feedback_no_api_key_billing.md`
- Reference impl: `packages/local-llm-router/src/claude-adapter.ts`
- Integration plan: `~/Documents/projects/reports/integration_remediation_plan_2026-05-14.md` §D Phase D1
