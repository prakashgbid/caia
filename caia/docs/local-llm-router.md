# local-llm-router

Routing layer that decides whether each task goes to local Ollama or to
Claude. Lives at `packages/local-llm-router`.

## Adapters

### `ClaudeAdapter` — binary spawn (subscription auth)

**Hard rule (Prakash 2026-04-30, see `feedback_no_api_key_billing.md`):
the pay-per-token Anthropic API path is forbidden. The Claude path uses
the `claude` CLI binary exclusively, which authenticates via the
logged-in Max-20x subscription session.**

Shape (LAI-001):

```ts
new ClaudeAdapter({
  binaryPath?: string,        // default: process.env.CLAUDE_BINARY_PATH ?? 'claude'
  homeOverride?: string,      // override HOME for per-account credentials dir
  accountId?: string | null,  // attribution for telemetry + rate-limit reporting
  timeoutMs?: number,         // default: 180_000
  spawnFn?: typeof spawn,     // test seam
})
```

The adapter spawns `claude --print --output-format json --model <model>`
and pipes the prompt over stdin. It clears `ANTHROPIC_API_KEY` and
`ANTHROPIC_AUTH_TOKEN` from the child env so the binary always uses the
subscription session, never the API key. The binary's JSON output is
parsed into the standard `LLMResponse`; `provider` is `'claude'`.

#### Errors

| Error class               | When                                                                                               |
|---------------------------|----------------------------------------------------------------------------------------------------|
| `ClaudeRateLimitedError`  | Anthropic returned 429/quota exhaustion. Subclass of `ClaudeBinaryError`. Carries `accountId`.     |
| `ClaudeBinaryError`       | Any other failure: missing binary, non-zero exit, malformed JSON, timeout, child error event.      |

The adapter NEVER falls back to API-key billing. The router's
`fallbackOnError` knob (default true) catches these errors and falls
back to **Ollama only**.

#### Account rotation

Per-account credentials live in different `~/.config/claude` dirs. The
spend-guard `AccountPool` picks an account, then constructs a
`ClaudeAdapter` with `homeOverride` pointing at the right per-account
home (e.g. `/Users/MAC/.caia/accounts/acc-2`). When that account's
session is rate-limited, the pool rotates to the next account; when both
are exhausted, the router falls back to Ollama (or pauses the pipeline
when the spend-guard `BudgetExceededError` is also live).

### `OllamaAdapter` — local

Unchanged. Pinned IPv4 (`127.0.0.1:11434`); chat-mode for thinking
models, generate-mode for everything else; 10-minute keep_alive default.

## Spend records

Every Claude call records a `SpendRecord` via `@chiefaia/spend-guard`
with `via: 'subscription'`. The orchestrator's bridge (`apps/orchestrator/src/safety/spend-guard-bridge.ts`)
constructs the guard with `rejectApiKeyVia: true` (default), so any
regression that records `via: 'api-key'` throws
`ApiKeyViaForbiddenError` at the cap-record boundary.

## No-API-key kludge for the daemon plist

The `com.caia.orchestrator` launchd plist still sets a cosmetic
`ANTHROPIC_API_KEY=<oauth-token>` env var to avoid noisy "missing key"
warnings emitted by older code paths that haven't been migrated to the
binary-spawn adapter yet. This is documented in
`reports/daemon_repoint_2026-04-30.md` and will be removed once every
caller is on the binary-spawn path. The kludge has no effect on the new
adapter — it explicitly clears the variable on every spawn.
