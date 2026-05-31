# Plan: B7 — LLM retry/backoff for wizard Claude calls

**Plan type:** implementation
**Caller agent:** Phase-B wizard pipeline (B7 of the 7-task series)
**Submitted by:** Stolution
**Affected components:** `@chiefaia/claude-spawner`, `apps/wizard`
**Spec:** Phase B brief 2026-05-31, task B7
**Branch:** `feature/wizard-b7-retry-backoff-2026-05-31`

## Goal

Wrap every Claude call the wizard makes (via `@chiefaia/claude-spawner`)
in an exponential-backoff + jitter retry envelope. Surface per-attempt
progress so the wizard step UI can render "Retrying in 60s (attempt
2/4)". On final retry exhaustion the wizard transitions the project's
FSM state to the explicit `*-failed` variant.

## Scope (V1 — this PR)

1. **Canonical helper** in `@chiefaia/claude-spawner` —
   `withRetry(fn, opts)` (in `src/retry.ts`) with:
   - defaults `maxRetries=3`, `baseDelayMs=30_000`, `factor=2`,
     `jitterPct=0.2` -> roughly 30s / 60s / 120s between attempts;
   - error classifier (`defaultClassifyError`) that returns
     `transient | auth | constraint | fatal`. Auth/constraint/fatal
     are NOT retried;
   - per-attempt OTel span (`claude.retry.attempt`) with attributes
     `caia.retry.attempt`, `caia.retry.total_attempts`,
     `caia.retry.error_class`;
   - `setTimeout`-based sleep (cancellable via `AbortSignal`);
   - progress callbacks `onAttempt` / `onRetry` / `onFinal` with a
     deterministic order.

2. **Wizard adapter** at `apps/wizard/lib/wizard/retry-spawner.ts` -
   `wizardWithRetry(binding, fn, opts)` re-exports the canonical
   helper and auto-plumbs progress events into the wizard's
   per-project channel. Strictly forbid parallel retry logic here.

3. **Progress channel** at `apps/wizard/lib/wizard/progress-channel.ts`
   - an in-memory ring buffer (32 events / project) keyed by
   `{tenantId, projectId}`. Surface via
   `GET /api/wizard/[projectId]/progress?since=<iso>`. The poll
   shape mirrors what `@chiefaia/event-bus-nats` would publish, so a
   future swap to NATS is a constructor replacement only.

4. **Route wiring** for the three Claude-spawning wizard routes:
   - `POST /api/wizard/interview/answer` - wraps the thread advance.
   - `POST /api/wizard/interview/complete` - wraps the FSM
     transition; on retry exhaustion transitions to
     `interviewing-failed` via `@caia/state-machine`.
   - `POST /api/wizard/proposal/generate` - wraps the full `runStep5`
     invocation.
   - All three return `attemptsRun` in the success envelope and a
     503 with `errorClass` on exhaustion.

5. **>=10 vitest cases** covering the matrix from the brief:
   - `packages/claude-spawner/tests/retry.test.ts` - 28 cases.
   - `apps/wizard/tests/wizard-shell/retry-spawner.test.ts` - 7 cases.

## Reuse-first compliance

- **`@chiefaia/claude-spawner`** - canonical spawner; the retry helper
  ships here so verifier/code-reviewer/critic adopt the same envelope.
- **`@chiefaia/tracing` v0.3.0** - `createTracer().withSpan(...)` for
  per-attempt spans. No new tracer.
- **`@caia/state-machine`** - `StateMachine.transition(...)` for the
  retry-exhaustion error transition. No inline FSM logic.
- **`@chiefaia/event-bus-nats`** - not used directly in V1 but the
  progress-channel shape is wire-compatible with its envelope.

## Subscription-only contract

The retry envelope does NOT introduce a new HTTP client. It re-invokes
the supplied function after a sleep. The auth-key scrub still runs
inside `spawnClaude` on every attempt. There is no API-key escape
hatch. Auth-class errors (401/403, "unauthorized", "oauth expired")
short-circuit the retry chain instead of hiding the auth problem
behind 30s of backoff.

## State-machine integration

The wizard already had `interviewing-failed`, `proposal-failed`, and
others in `@caia/state-machine`. On retry exhaustion the
`interview/complete` route now best-effort-transitions to
`interviewing-failed` so the operator UI shows the explicit failure
state instead of a generic "something went wrong".

## Files

- `packages/claude-spawner/src/retry.ts` - canonical retry helper.
- `packages/claude-spawner/src/index.ts` - re-export retry surface.
- `packages/claude-spawner/tests/retry.test.ts` - 28 vitest cases.
- `apps/wizard/lib/wizard/retry-spawner.ts` - wizard adapter.
- `apps/wizard/lib/wizard/progress-channel.ts` - per-project ring buffer.
- `apps/wizard/app/api/wizard/[projectId]/progress/route.ts` - poll endpoint.
- `apps/wizard/app/api/wizard/interview/answer/route.ts` - wired.
- `apps/wizard/app/api/wizard/interview/complete/route.ts` - wired + failure transition.
- `apps/wizard/app/api/wizard/proposal/generate/route.ts` - wired.
- `apps/wizard/tests/wizard-shell/retry-spawner.test.ts` - 7 cases.

## Tests

`packages/claude-spawner/tests/retry.test.ts` covers the B7 matrix:

1. 1st attempt succeeds - no retry, no sleep.
2. Transient fail - retry success on attempt 2.
3. All attempts fail - final error state surfaced with classification.
4. Auth error - no retry, immediate fail.
5. Constraint error - no retry, immediate fail.
6. Jitter randomization stays within `+/-jitterPct` bounds (200 samples).
7. Backoff delay increases (30s -> 60s -> 120s with zero jitter).
8. Respects `maxRetries=0`, `maxRetries=1`, `maxRetries=3`.
9. Per-attempt span created (verified via thrown -> outcome conversion).
10. Abort signal cancels in-flight retry; pre-aborted signal skips all.
11. Progress events emitted in correct order across success/fail paths.
12. `sanitizeDiagnostic` strips `sk-***` tokens and truncates long output.
13. `fromSpawnResult` adapter lifts `SpawnClaudeResult` cleanly.

## Scope (deferred — follow-up PRs)

- Wiring the retry envelope into the other six claude-spawner consumers
  (verifier, code-reviewer, critic, reviewer, apprentice-eval,
  apprentice-corpus, researcher).
- Per-tenant override knobs (a tenant with `WIZARD_RETRY_MAX_RETRIES`
  set in their config). Current implementation uses static defaults.
- Persisting progress events across pod restarts. The in-memory ring
  buffer is fine for V1 cardinality; horizontal scale swaps to NATS.
- Per-attempt prompt mutation (e.g. dropping cache headers on retry).

## Hard rules satisfied

- Reuse-first: no new HTTP client, no parallel retry logic, no parallel
  tracer.
- `setTimeout`-based sleep with jitter - no sync sleep blocks the
  event loop.
- Vitest fake timers in tests so the suite runs in ~10ms instead of
  30+ seconds.
- AbortSignal support: cancels in-flight retry; pre-aborted signals
  skip the call entirely.
- Tolerates pre-existing CI fails: wizard typecheck has unrelated
  errors in AtlasWizardClient + edge-bypass.test.ts that pre-date this
  PR.
