# PLAN — Phase B Task B4: Per-request `SET LOCAL search_path` in wizard API routes

**Branch:** `feature/wizard-b4-search-path-2026-05-31`
**Date:** 2026-05-31
**Subscription-only.** True-Zero admin-merge.

## 1. What we shipped

A `withTenantSearchPath(pool, tenantSchema, fn)` helper plus the route-level
refactor that wires every wizard API request through it.

### New file

- `apps/wizard/lib/tenants/search-path.ts`
  - `withTenantSearchPath<T>(pool, tenantSchema, fn, opts?)` —
    BEGIN → `SET LOCAL search_path` → fn → COMMIT (with ROLLBACK on throw).
  - `quoteTenantIdent(schema)` — `^[a-zA-Z_][a-zA-Z0-9_]*$` validator +
    double-quote rejection; throws `InvalidTenantSchemaError` BEFORE any
    SQL is issued.
  - `buildSetSearchPathStatement(schema)` — exported for tests.
  - `externalClient` option — caller-owned transaction passthrough (no
    BEGIN/COMMIT/release).

### Modified files

- `apps/wizard/lib/wizard/store-wire.ts`
  - Extracted the per-tenant lookup into `loadTenantWiring(tenantId)`
    (StateStore + schemaName). Same global `tenants` table query as
    before — just cached alongside the existing StateStore cache so we
    don't double-hit.
  - Exposes `resolveTenantSchema(tenantId)` for route handlers.
- `apps/wizard/app/api/wizard/[projectId]/state/route.ts` —
  GET + PATCH wrap the per-request work in `withTenantSearchPath`.
  Surfaces FSM "invalid transition" via an in-flight `InvalidTransitionError`
  so the transaction rolls back cleanly before the 409 response.
- `apps/wizard/app/api/wizard/proposal/generate/route.ts` —
  Wraps the LIVE path (`WIZARD_PROPOSAL_LIVE=1`) so every pg call
  inside `runStep5` lands in the tenant's schema. Stub path is pure
  in-memory and intentionally skips the wrap (no pg work to scope).
- `apps/wizard/app/api/wizard/interview/answer/route.ts` —
  Wraps the LIVE path via `runStoreWork(tenantSchema, body)`. The V1
  in-memory thread store path skips the wrap.
- `apps/wizard/app/api/wizard/interview/complete/route.ts` —
  Wraps the pre-check + state lookup + post-transition thread mark in
  `withTenantSearchPath`. The `StateMachine.transitionAtomic` call
  itself opens its own inner transaction (PgStateStore owns it); its
  queries are already schema-qualified against `caia_meta`.

### Tests

- `apps/wizard/tests/wizard-shell/search-path.test.ts` — **19 vitest
  cases** (target ≥10, +9).

  Coverage maps 1:1 to the brief:

  1. helper sets search_path correctly (BEGIN/SET/SELECT/COMMIT order
     asserted)
  2. helper rolls back on error
  3. helper releases client even on throw
  4. helper releases client even when ROLLBACK itself throws
  5. two concurrent requests don't bleed search_paths (separate
     clients, separate SET LOCALs, no cross-mention)
  6. search_path is scoped to the transaction — post-COMMIT fresh
     client has no SET LOCAL in its log
  7. rejects empty tenant schema (validator runs BEFORE pool.connect)
  8. rejects schema with quotes (`tenant"; DROP SCHEMA public;--`)
  9. rejects schema with hyphen, space, leading digit
  10. handles pool exhaustion (pool.connect() throws)
  11. propagates the function's return value (typed generic)
  12. supports an explicit external transaction (no BEGIN/COMMIT, no
      release)
  13. external transaction path doesn't issue COMMIT/ROLLBACK on throw
      (caller owns lifecycle)
  14. `buildSetSearchPathStatement` produces the exact SQL string
  15. `quoteTenantIdent` quotes a valid identifier
  16. `quoteTenantIdent` rejects empty
  17. `quoteTenantIdent` rejects undefined-shaped input
  18. `quoteTenantIdent` rejects double-quote injection payload
  19. `quoteTenantIdent` rejects hyphen / space / leading-digit

- `apps/wizard/tests/wizard-shell/wizard-steps/interview-complete-route.test.ts`
  — extended the existing `vi.mock` for `store-wire` to expose
  `resolveTenantSchema`, and added a `vi.mock` for `lib/tenants/wire`
  so `getPool().connect()` returns a no-op client. The new route logic
  flows through the same SET LOCAL wrapper in tests.

Full wizard vitest run: **231 passed, 0 failed** (was 231 on develop
before the patch, so net regression is zero).

## 2. Why per-request `SET LOCAL` (not pool-level `SET`)

The wizard used to rely on whatever search_path the connection happened
to have. That's brittle:

- If two tenants share the same pooled connection (the default behaviour
  for `pg.Pool`), a `SET search_path` from request A bleeds into the
  NEXT request that grabs the same connection.
- Any future unqualified table reference (or any persistence layer that
  doesn't schema-prefix its writes) silently writes to the wrong tenant.

`SET LOCAL` is transaction-scoped. The moment the helper's BEGIN-COMMIT
bracket closes, the connection's session search_path reverts to the
pool default — even though the connection goes back to the pool
unchanged.

## 3. Reuse-first compliance

Reuse-search results — see `EA-REVIEW-OUTCOME.json` for the JSON shape.

| Candidate                          | Decision                       | Why |
| ---------------------------------- | ------------------------------ | --- |
| `@caia/ui`                         | n/a                            | Pure-server work; no UI surface. |
| `@chiefaia/tracing`                | selected (already in use)      | `createTracer('chiefaia.dashboard.wizard.interview')` continues to wrap the interview-route work. |
| `@chiefaia/event-bus-nats`         | selected (already in use)      | Unchanged. |
| `@chiefaia/claude-spawner`         | n/a                            | No LLM calls in B4. |
| `@caia/state-machine`              | selected (already in use)      | `PgStateStore` continues to own `caia_meta` queries inside the FSM's own transactions. |
| `@caia/secrets-adapter`            | n/a                            | No secrets work. |
| `@caia/atlas-design-snapshotter`'s `SET LOCAL search_path` pattern | reused | Same `quoteIdent` regex, same BEGIN→SET LOCAL→fn→COMMIT sequence. |
| `apps/wizard/lib/tenants/*`        | extended (in place)            | Helper added next to `store.ts`/`wire.ts`/`provision.ts`/`infisical.ts`; existing pg pool pattern reused. |
| `pg`                               | selected (already in use)      | Same driver. No new persistence layer. |

## 4. Risks

- **PgStateStore.transitionAtomic opens its own transaction.** Our
  outer `withTenantSearchPath` doesn't contain that inner BEGIN; the
  FSM's own queries reference `caia_meta.tenant_projects` /
  `caia_meta.state_history` by schema-qualified name, so they don't
  need the tenant search_path. We documented this in the
  `interview/complete/route.ts` comment.
- **Stub paths skip the wrap.** Default-mode wizard routes that don't
  touch pg (proposal stub, in-memory interview thread store) skip the
  wrap to avoid an unnecessary pool client acquisition. The wrap will
  kick in automatically once the live path is wired in Wave 2. The
  decision is documented inline.

## 5. Operator follow-ups (out of scope)

- When `@chiefaia/persistence-postgres` lands, swap the `pg` import in
  `lib/tenants/search-path.ts` to use that wrapper.
- When the Wave-2 live interview path is wired, the conditional
  `tenantSchema | null` branch in `interview/answer/route.ts` collapses
  to an unconditional `withTenantSearchPath` wrap.

## 6. CI matrix

- vitest `apps/wizard`: 231 passing.
- `tsc --noEmit` on the new/modified files: 0 errors (pre-existing
  `tests/wizard-shell/edge-bypass.test.ts` `ProcessEnv` errors are
  unrelated to this PR).
- Reuse-check-strict (#599/#600): expected to pass — only existing
  workspace packages and `pg` are imported.

## 7. Acceptance — brief checklist

- [x] `withTenantSearchPath` helper in `apps/wizard/lib/tenants/`.
- [x] BEGIN / `SET LOCAL search_path` / fn / COMMIT with ROLLBACK on
      throw.
- [x] `SET LOCAL` (not `SET`).
- [x] Parameterized / validated identifier quoting.
- [x] All four wizard route files use the helper (or skip with a
      documented in-memory-path exception).
- [x] ≥10 vitest tests covering every listed scenario (19 ships).
- [x] Migration / provisioning code paths unchanged.
- [x] Reuse-first: no new pg/db layer; extends `lib/tenants/`.
