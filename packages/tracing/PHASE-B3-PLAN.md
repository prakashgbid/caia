# Phase B B3 — Deeper OTel wiring in wizard Claude calls

## What this change does

Extends `@chiefaia/tracing` with `withClaudeSpawnerSpan` (and a thin
`withClaudeSpawnerChildSpan` variant) and wires the helper into every
wizard API route that touches `@chiefaia/claude-spawner` (directly or
transitively). The wrapper carries wizard-step semantic attributes
that Tempo can filter on, and the OTel context manager threads it as
the parent of the `claude.spawn` span the spawner already emits.

## Surface added

```ts
// packages/tracing/src/claude-spawner-instrumentation.ts
withClaudeSpawnerSpan(attrs, fn, opts?): Promise<T>
withClaudeSpawnerChildSpan(attrs, fn, opts?): Promise<T>

interface WizardClaudeSpanAttributes {
  step?: string;              // 'interview.answer' | 'interview.complete' | 'proposal.generate'
  projectId?: string;
  tenantId?: string;
  promptTemplate?: string;    // 'interviewer:playbook.v1' | 'proposal:runStep5.v1' ...
  model?: string;             // 'claude-opus-4-6'
  turn?: number;
  extra?: Record<string, string | number | boolean>;
}
```

Span attributes recorded by the wrapper:

- `caia.wizard.step`
- `caia.wizard.project_id`
- `caia.wizard.tenant_id`
- `caia.wizard.turn` (optional)
- `caia.claude.prompt_template`
- `caia.claude.model`
- `caia.claude.duration_ms`
- `caia.claude.ok` (boolean)
- plus any `extra` keys verbatim (currently `caia.claude.live: boolean`)

The span name defaults to `claude.spawn.wizard` so Tempo's
"operation = claude.spawn.wizard" filter immediately surfaces all
wizard-side claude usage.

## Why a wrapper instead of new spawner-side attributes

`spawnClaude` already emits a `claude.spawn` span carrying binary
path / model / exit code / duration — but it has no knowledge of the
wizard step, project, tenant, or prompt template. Adding those
attributes there would force every caller (verifier, code-reviewer,
critic, etc) to plumb wizard-specific fields through the spawner
options surface. Instead the wizard wraps each call site with the
wizard semantic attributes, and the spawner's own span sits as a
child carrying its lower-level diagnostics:

```
wizard route          (tracer.withSpan 'wizard.interview.answer')
 └─ withClaudeSpawnerSpan  → claude.spawn.wizard  [+wizard attrs]
     └─ spawnClaude        → claude.spawn         [+binary attrs]
```

## Routes wrapped

| Route                                       | Live path calls claude? | Wrapped |
| ------------------------------------------- | ----------------------- | ------- |
| `POST /api/wizard/interview/answer`          | Yes (WIZARD_INTERVIEW_LIVE=1) | Yes (per turn) |
| `POST /api/wizard/interview/complete`        | Wave 2 (critic-coverage decision) | Yes (stub site too) |
| `POST /api/wizard/proposal/generate`         | Yes (WIZARD_PROPOSAL_LIVE=1) | Yes (whole runStep5) |
| `GET/PATCH /api/wizard/[projectId]/state`    | No (FSM only)            | N/A |

Per the task spec, `/api/wizard/architecture/run` was listed but does
not yet exist on `origin/develop` (HEAD `106f281`) — scope reduced to
the 4 routes that DO exist, as the spec permits.

## W3C TraceContext propagation

The wrapper threads the new span into `OtelContext.with(...)` so any
nested OTel operation inside `fn` — including the transitive
`claude.spawn` span from claude-spawner and any `injectContext()`
write into an outbound NATS / HTTP carrier — sees the wizard span as
its parent. The `traceparent` header emitted by `injectContext`
therefore carries the wizard span's `trace_id`, which is what Tempo
uses to stitch traces across process boundaries (wizard pod →
engine pod → claude binary).

## Tests added

`packages/tracing/tests/claude-spawner-instrumentation.test.ts` — 17 tests:

1. emits a span with the default operation name
2. honours `operationName` override
3. sets `caia.wizard.step` / `project_id` / `tenant_id`
4. sets `caia.claude.prompt_template` / `caia.claude.model`
5. passes through `extra` attributes verbatim
6. sets `caia.wizard.turn` when provided
7. omits attributes when callers don't supply them
8. returns fn result and marks span OK on resolve
9. records `caia.claude.duration_ms`
10. rethrows errors and marks span ERROR with message on reject
11. records duration even on reject
12. ends span on reject (no leak)
13. inherits traceId of an active route-level parent span
14. uses an explicit parent context when provided (remote parent)
15. round-trips trace_id via injectContext / extractContext (W3C)
16. nests multiple wizard claude calls under the same route span (multi-step)
17. `withClaudeSpawnerChildSpan` emits the `.child`-suffixed name

All 45 tests in the package pass (`pnpm --filter @chiefaia/tracing test`):

```
 Test Files  6 passed (6)
      Tests  45 passed (45)
```

## Reuse-first compliance

- Extends `@chiefaia/tracing` (the canonical OTel surface) — no parallel
  `@chiefaia/otel` shipped.
- Wraps `@chiefaia/claude-spawner` calls — no raw `child_process.spawn`
  or shell-out to `claude` introduced.
- Adds one devDep (`@opentelemetry/context-async-hooks`) used only by
  the test suite to install the SDK's standard AsyncLocalStorage
  context manager (mirrors what `initTracing` does in production).

## Subscription-only contract

This helper is purely OTel glue. It does not invoke `claude`, set
`ANTHROPIC_API_KEY`, or hold tokens. The wrapped `fn` MUST call
through `@chiefaia/claude-spawner.spawnClaude` (directly or
transitively via the existing `@caia/interviewer` /
`@caia/business-proposal-generator` packages, which all already pass
`constraints: { rejectIfApiKeyPresent: true }`).
