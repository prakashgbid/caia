# PLAN — @caia/wizard-tenant-bootstrap

**Branch:** `feature/wizard-tenant-migration-runner-2026-05-25`
**Cut from:** `origin/develop`
**Closes:** Phase A3 of `reports/wizard_live_e2e_gap_analysis_2026-05-25.md`

## Goal

When a new tenant is provisioned (Cloudflare Access first-sign-in → `apps/dashboard/middleware.ts` → `provisionTenant(email)`), the per-tenant Postgres schema must be **fully populated** with every wizard step's tables before the global `tenants` row is inserted. Today the schema is created empty; per-package `ensureSchema()` runs lazily on first DB access, which fails when SSR reads `wizard_state` before any persistence-layer code has executed.

## Reuse-search outcomes (per ADR-065)

| Searched | Outcome |
|---|---|
| `packages/wizard-tenant-bootstrap`, `packages/tenant-bootstrap` | **No existing facade.** New package justified. |
| `node-pg-migrate`, `pg-migrate`, `umzug`, `knex` as workspace deps | **Not present.** No new migration-tool dep added — we reuse the existing `{{SCHEMA}}` substitution convention. |
| `testcontainers` as workspace dep | **Not present.** Integration test follows the existing pattern (`@caia/secrets-postgres`, `@caia/atlas-design-snapshotter`): gated by `PG_INTEGRATION_URL`, skips when unset, ships a `docker-compose.test.yml` for local + CI. |
| `applyMigrations` / `runMigrations` helper | **Not present.** Each per-tenant package has its own lazy `ensureSchema()` that copies the same read-substitute-execute logic. Centralising this in `@caia/wizard-tenant-bootstrap/runner` is reuse — the packages can converge on it in a follow-up. |
| `@chiefaia/event-bus-nats` API surface | **Reused.** The orchestrator's `BootstrapEventPublisher` matches the structural type already used by `apps/dashboard/lib/tenants/provision.ts::EventPublisher`. |
| `schemaNameForEmail()` from dashboard | **Reused as the canonical name source.** The orchestrator never derives a tenant schema name itself — it takes `schemaName` as a parameter. |

## Architectural decisions (resolved from AUDIT.md's 3 blockers)

### Blocker 1 — Schema-name mismatch → option (c)

The orchestrator does NOT compute a schema name. It accepts `schemaName: string` from the caller (`provisionTenant`, which uses `schemaNameForEmail()`). The per-package persistence classes' internal `tenantSchemaName(slug)` helpers continue to exist for backward compatibility, but the orchestrator path doesn't use them.

**Per-package extension (next-best change, not mandatory for THIS PR):** each per-tenant package's `ensureSchema()` is extended to accept an optional `schemaName?: string` that overrides the constructor-derived value. Existing callers don't pass it, so behavior is unchanged for them. This means the orchestrator can — in a follow-up — call each package's `ensureSchema(canonicalSchemaName)` instead of re-applying the SQL itself. For THIS PR the orchestrator owns migration application directly via the centralised runner (simpler, fewer cross-package edits, smaller blast radius).

### Blocker 2 — `@caia/design-ingest` stays row-level

`@caia/design-ingest`'s `ux_uploads` table uses `tenant_id UUID` as a row-level discriminator instead of per-tenant schema isolation. This is deliberate: it's an "uploads ledger" closer to a global event log than per-tenant business data. Documented here + in AUDIT.md §4 Blocker 2. A future ADR can ratify the pattern split.

### Blocker 3 — Live verification follow-up

`stolution-remote` MCP returns `SASL: SCRAM-SERVER-FIRST-MESSAGE: client password must be a string` on every DB query. Live verification against the stolution Postgres is **deferred** to a follow-up task that fixes the MCP's DB env. The integration test in this PR uses an ephemeral Postgres (`docker-compose.test.yml`) instead.

## Layers (already shipped in this branch)

```
src/types.ts          Public TypeScript surface — small + stable
src/schema.ts         Validate + quote tenant_<…> schema names
src/manifest.ts       The canonical per-tenant migration list (5 entries)
src/tracker.ts        _migrations_applied table CRUD + sqlChecksum
src/runner.ts         Substitute placeholder, apply, record outcome
src/orchestrator.ts   bootstrapTenant() + dropTenantSchema() + listTenantTables()
src/index.ts          Re-exports
```

## Integration points

### `apps/dashboard/lib/tenants/provision.ts`

Between step 2 (`ensureTenantSchema`) and step 4 (`tenantStore.insertIfAbsent`), the provisioner now calls:

```ts
const bootstrap = await bootstrapTenant({
  pool: deps.pool,
  schemaName,
  publisher: deps.publisher,
});

if (!bootstrap.success) {
  await dropTenantSchema(deps.pool, schemaName);
  await deleteInfisicalProject(project.projectId, deps.infisical);
  throw new Error(
    `provisionTenant: bootstrap failed for ${schemaName} — ` +
      `${bootstrap.failures.map((f) => f.package + ':' + f.filename + ' ' + f.error).join('; ')}`,
  );
}
```

The tenants row insert happens only AFTER bootstrap succeeds, so a partial provisioning (schema + infisical without bootstrap) leaves no orphan row in the global table. Idempotency at step 1 (fast-path `findByEmail`) still works because the schema name is deterministic from email.

### `@chiefaia/event-bus-nats` event type

Adds `tenant.migrations.complete` to the bus vocabulary. This PR does NOT register it in `WAVE_1A_EVENT_TYPES` — that flip is an ops-side decision (the bus skips NATS routing for unknown types and logs a warning, which is the desired fallback). When the operator is ready, they add it to the env flag the dashboard's `wire.ts` reads.

## Tests (≥20 cases, all in `tests/`)

The hermetic suite uses a hand-rolled mock `pg.Pool` so it runs without Docker. The integration suite (`tests/integration/`) skips when `PG_INTEGRATION_URL` is unset.

## Follow-ups (out of scope for this PR)

1. Fix the `stolution-remote` MCP DB env so a real production-DB verification can run.
2. Migrate the per-package `ensureSchema()` methods to delegate to `@caia/wizard-tenant-bootstrap/runner` — eliminates the read-substitute-execute duplication across 4 packages.
3. Decide whether `@caia/design-ingest`'s `ux_uploads` stays row-level or migrates to schema isolation. Likely a separate ADR.
4. Add `tenant.migrations.complete` to `WAVE_1A_EVENT_TYPES` once ops is ready.
