# @caia/wizard-tenant-bootstrap

Per-tenant Postgres migration orchestrator for the CAIA wizard. Plugged into `apps/dashboard/lib/tenants/provision.ts` so a freshly provisioned tenant ends up with every per-tenant package's schema fully populated, atomically, before the global `tenants` row is inserted.

Closes the Phase A3 gap from `reports/wizard_live_e2e_gap_analysis_2026-05-25.md`: the existing per-package `ensureSchema()` runs only on first DB access, which means a tenant whose wizard SSR reads `wizard_state` before any package's persistence layer is exercised hits `relation "tenant_…"."wizard_state" does not exist`. This package eliminates that race by applying every per-tenant migration at provision time.

## Manifest (per-tenant only)

Five migrations are applied in order:

```
@caia/grand-idea                      → 001_grand_ideas.sql
@caia/interviewer                     → 0001_interviewer.sql
@caia/info-architect                  → 0001_info_architect.sql
@caia/business-proposal-generator     → 0001_business_proposals.sql
@caia-app/dashboard                   → 0010_wizard_state.sql
```

Global migrations (`@caia/state-machine`, `@caia/onboarding`, `@caia/design-ingest`, dashboard `0011_tenants_global.sql`) are intentionally out of scope — see `AUDIT.md` §2 + §4.

## Usage

```ts
import { bootstrapTenant } from '@caia/wizard-tenant-bootstrap';

const result = await bootstrapTenant({
  pool,                  // pg.Pool
  schemaName,            // 'tenant_<safe>_<fnv-hash>' from schemaNameForEmail()
  publisher,             // optional — emits 'tenant.migrations.complete' on the bus
});

if (!result.success) {
  // result.failures has the per-package errors; provisionTenant rolls back.
}
```

## Idempotency

A per-schema `"<schema>"._migrations_applied` ledger records every (package, filename, checksum). Calling `bootstrapTenant` twice for the same schema short-circuits — every outcome comes back as `kind: 'skipped'`. Editing a SQL file changes the checksum and triggers a `kind: 'reapplied'` (safe because the underlying SQL is all `CREATE … IF NOT EXISTS` / `DROP TRIGGER IF EXISTS … CREATE TRIGGER`).

## Tests

```bash
pnpm --filter @caia/wizard-tenant-bootstrap test                # hermetic unit tests (default)
pnpm --filter @caia/wizard-tenant-bootstrap test:integration    # requires PG_INTEGRATION_URL
```

The integration suite spins up against a real Postgres via the included `docker-compose.test.yml`:

```bash
docker compose -f docker-compose.test.yml up -d
PG_INTEGRATION_URL=postgres://caia:caia@localhost:54322/caia_test \
  pnpm --filter @caia/wizard-tenant-bootstrap test:integration
docker compose -f docker-compose.test.yml down -v
```

See AUDIT.md §6 for the live-verification status (currently blocked on `stolution-remote` MCP DB creds).

## Files

```
AUDIT.md                  Audit deliverable — what migrations exist + the 3 architectural blockers we resolved
PLAN.md                   Plan + reuse-search outcomes
docker-compose.test.yml   Local Postgres for the integration test
migrations/               (none — this package does not ship its own per-tenant migration)
src/index.ts              Public exports
src/orchestrator.ts       bootstrapTenant() + dropTenantSchema()
src/runner.ts             applyMigration() + applyManifest() + substituteSchema()
src/tracker.ts            _migrations_applied table CRUD
src/manifest.ts           DEFAULT_MANIFEST (per-tenant migration list)
src/schema.ts             tenant_<…> name validation + safe quoting
src/types.ts              Public TypeScript types
tests/                    Unit tests (≥20 cases)
tests/integration/        Real-Postgres integration test
```
