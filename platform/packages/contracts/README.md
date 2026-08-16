# @caia/contracts

Single source of truth for **every** cross-microfactory contract in CAIA.

- `schemas/` — canonical JSON-Schema (draft 2020-12) for events, artifacts, RPC messages
- `src/` — hand-written TypeScript re-exports + generated types (`tsc` output → `dist/`)

## Rules

1. **Schema-first.** Never change a `.ts` type by hand — change the JSON-Schema
   and regenerate.
2. **Semver on every schema.** Additive changes bump minor; breaking bump major.
3. **Consumers pin.** Every consumer imports `@caia/contracts` at a fixed version.
4. **Contracts belong to the producer's microfactory** — the SF that emits the
   event/artifact owns the schema.
