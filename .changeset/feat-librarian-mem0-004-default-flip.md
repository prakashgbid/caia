---
"@chiefaia/librarian": minor
---

feat(librarian-mem0-004): flip default backend from `sqlite-vec` to `mem0`

Phase-2 default-flip for Librarian's pluggable memory backend. The
implementation has shipped behind a flag since PR #369 (2026-05-06)
and the A/B harness in PR #370 measured Mem0 winning 7/10 top-1 hits
vs sqlite-vec's 3/10 on the live 286-file CAIA corpus. Latency is
~6× higher (avg 190ms / p95 307ms vs 30ms / 44ms) but well under the
1-2 second pre-spawn budget. Hard constraints all hold: no Anthropic
API key, no OpenAI API key, no per-token billing. Markdown remains
source of truth.

**What changes**

- `DEFAULT_BACKEND` in `packages/librarian/src/backends/types.ts`
  flips from `'sqlite-vec'` → `'mem0'`. Callers that don't pass a
  `backend` flag now route to the Mem0 dispatcher.
- `'sqlite-vec'` remains a fully-supported opt-in backend for tests
  and rollback. Phase-1 code is not removed.
- Test `mem0-backend.test.ts` adds a parity smoke test exercising
  build → retrieve → prepend on BOTH backends and asserting the
  result shapes are structurally compatible (same `RetrievedPrecedent`
  keys, same preamble header, same `PrependPrecedentResult` shape).

**Operator authorization**

Per `feedback_validation_decisions_2026-05-06.md` decision #4
("Mem0 swap baked into Librarian Phase 2") and the 2026-05-08
"scaling forward" directive.

**Re-evaluation triggers** (any one fires → revert default to
`'sqlite-vec'`):

- Mem0 v3.x ships a schema-breaking change.
- Operator's day-to-day usage shows >2 missed top-1 retrievals out of
  any 10-query window.
- Latency p95 grows past 500ms at corpus scale.
