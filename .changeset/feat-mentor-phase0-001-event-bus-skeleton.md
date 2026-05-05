---
"caia": patch
---

feat(mentor-phase0-001): event-bus skeleton + types + schemas + SQLite client (PR-α)

First PR of the Mentor Phase 0 roadmap (item 2 in the multi-day campaign
roadmap). Sets up the typed append-only event substrate that subsequent
PRs (β/γ/δ) will extend.

## What landed

A new monorepo package `@chiefaia/mentor-event-bus` under
`packages/mentor-event-bus/`:

- `src/types.ts` — 22 EventTypes (per
  `agent/memory/mentor_agent_directive.md` Phase 0 taxonomy) + per-event
  payload contracts + `PayloadOf<T>` mapping.
- `src/schemas.ts` — Zod schemas for each EventType payload + a
  registry (`EVENT_SCHEMAS`) + `validatePayload` helper that returns a
  discriminated result rather than throwing.
- `src/sqlite.ts` — SQLite client (better-sqlite3) with WAL mode,
  idempotent migration runner, monotonic `ingest_offset` allocator,
  typed `insertEvent`/`queryEvents`/`countEvents` primitives.
- `migrations/0001_init.sql` — `events` + `schema_definitions` +
  `_ingest_counter` tables with composite indexes for the common
  query shapes.
- `src/correlation.ts` — `withCorrelation` /
  `withCorrelationAsync` helpers built on `AsyncLocalStorage` so any
  nested `emit()` inherits the active `correlation_id` without the
  caller threading it manually.
- `src/client.ts` — `Client` class: `emit(type, payload, opts?)` /
  `getRecent(opts?)` / `count(opts?)` / `close()`. Schema validation
  failures persist with `validation_failed = 1` rather than throwing
  (preserves the producer-non-blocking invariant).
- `src/index.ts` — public API barrel.

## Producer-non-blocking invariant

`emit()` never throws. Every error path (DB write fail, schema violation,
JSON.stringify fail, post-close emit) is caught and logged via
`pino`-style `logger.warn`. This is the most important property of the
substrate per the design doc.

## Tests

42 new tests (5 files):

- `tests/types.test.ts` — 22 event types, no duplicates, every type has a schema.
- `tests/schemas.test.ts` — happy-path + validation-failure assertions for
  every important schema.
- `tests/sqlite.test.ts` — DB open / migrate / insert / query / count /
  schema_definitions persistence; monotonic offsets; query filters;
  idempotency on re-open.
- `tests/correlation.test.ts` — async-context propagation across awaits +
  setTimeouts; nested-correlation override; reset after fn returns.
- `tests/client.test.ts` — emit+read; validation-failure persistence;
  withCorrelation inheritance; explicit-options override; persistence
  across close+reopen; emit-after-close returns null + logs warn.

## Subscription-only compliance

Dependencies: `better-sqlite3` (already in tree via `llm-cache`),
`nanoid` (already in tree), `zod` (already in tree). Zero paid services.

## Out of scope (subsequent PRs)

- HTTP server + cross-machine HTTP client (PR-β)
- Three Phase-0 emit-points + `caia mentor tail` CLI (PR-γ)
- LaunchAgent plists + install script (PR-δ)
- Phase 1+ classification engine, pre-spawn injection hook, Steward-rule
  proposer (Phase 1+, separate item)

References: `~/Documents/projects/reports/mentor-phase0-analysis.md`,
`agent/memory/mentor_agent_directive.md`,
`agent/memory/feedback_no_api_key_billing.md`.
