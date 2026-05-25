# Plan: @caia/atlas-prompt-router — Atlas Step 6, per-scope prompt routing

**Plan type:** implementation
**Caller agent:** `@caia/atlas-prompt-router`
**Submitted by:** Stolution
**Affected components:**
- `@caia/atlas-prompt-router` (new)
- `@caia/atlas-ui` (consumes the wire shape this router serves)
- `@chiefaia/atlas-mapper` (`descendantTickets` for fan-out)
- `@caia/state-machine` (consumes `change-requested` transition)
- `@caia/ea-dispatcher` (consumes the fan-out callout)

## Goal

Build the per-scope prompt-router for the Atlas module — the backend
behind `apps/atlas`'s `POST /api/atlas/tickets/:id/prompt`
(`research/atlas_module_spec_2026.md` §4 + §5.3) — packaged as a
reusable, transport-agnostic library so the Next.js route handler
(and any future Server Action / RPC wrapper) calls a pure
`submitPrompt` function with all I/O bound at composition time.

Fourth Atlas-* package in the canonical pipeline:

```
atlas-ui ──submit──▶ atlas-prompt-router ──fan-out──▶ ea-dispatcher
                            │
                            ├── persists version snapshot
                            ├── emits "change-requested" transition
                            └── resolves scope via @chiefaia/atlas-mapper
```

## Contract (§4 + §5.3)

Input:

```ts
interface AtlasSubmitPromptRequest {
  prompt: string;
  selection: string[];
  promptGroupId?: string | null;
  ts: string;
}
```

Output:

```ts
interface AtlasSubmitPromptResponse {
  versionId: string;
  ticketState: TicketState;
  expectedChangeDescription: string;
  dispatchedTo: string[];
  enqueuedAt: string;
}
```

Server behaviour:
1. Validate prompt, selection, ts.
2. Classify scope (self-only / subtree / page).
3. Insert ticket_versions snapshot.
4. Emit `change-requested` transition.
5. Fan out EA dispatch — `descendantTickets(ticketId)` for subtree,
   `[ticketId]` otherwise.
6. Return the wire response.

## Files

- `src/router.ts` — `createRouter(deps, opts)` factory + `submitPrompt`.
- `src/api.ts` — `createAtlasPromptApiHandler(router)`.
- `src/validation.ts` — sanitization + length + body-size cap.
- `src/scope-resolver.ts` — `IntentClassifier` port + Claude Haiku impl.
- `src/clock.ts`, `src/id.ts` — Clock + IdGen ports.
- `src/types.ts` — RouterDeps + every port interface.
- `src/index.ts` — public surface.
- `tests/*.test.ts` — ≥40 unit + integration smoke (already-present
  prakash-tiwari fixture).

## Reuse

- `@caia/atlas-ui` — wire shapes mirrored locally (atlas-ui dist isn't
  required in the build chain for this package).
- `@chiefaia/atlas-mapper` — `descendantTickets`.
- `@caia/state-machine` — `TriggeredBy` typing for the operator trigger.
- `@caia/ea-dispatcher` — consumer of the enqueue port.

## State-machine integration

Transition: `* → change-requested` keyed on the ticket. `previousState`
is whatever the caller passes (default `approved`); `newState` is
always `change-requested`. The state-machine adapter is the
authoritative legality checker — rejection surfaces as
`RouterError.kind = 'invalid-transition'` (HTTP 409).

We do NOT extend `transitions.ts` in `@caia/state-machine`. The
ticket-level FSM already supports `change-requested` as a re-entrant
state per spec §5.2.

## Validation rules (spec §4.1 + §4.5)

- `prompt`: required, trimmed length in [1, 8192].
- `selection`: required, ≥1 ticket id, each ASCII-printable, ≤ 200
  chars, no duplicates.
- `ts`: required ISO-8601 (UTC or offset).
- `promptGroupId`: optional, ≤ 64 chars, `[A-Za-z0-9_-]+`.
- whole-body wire size ≤ 64 KiB.

## Multi-select (spec §4.4)

When `selection.length > 1`: loop per ticket, share a
`prompt_group_id`, return the response for the path-param ticket.

## Quality gates

- `pnpm -F @caia/atlas-prompt-router build` clean.
- `pnpm -F @caia/atlas-prompt-router typecheck` clean.
- `pnpm -F @caia/atlas-prompt-router test` green — ≥ 40 tests.
- True-Zero on caia preserved — admin-merge ratified by operator.

## Risk register check

- No PR-platform coupling; router never sees a PR URL.
- No live LLM calls in tests; `IntentClassifier` + `ExpectedChangeWriter`
  are ports.
- Deterministic clock + ids; router never reads `Date.now()` or
  `crypto.randomUUID()` directly.
- Multi-tenancy: router accepts `designVersionId` per call but does NOT
  perform tenant-resolution; trusts the caller (apps/atlas middleware).

## Approval request

Approve to proceed.
