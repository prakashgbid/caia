/**
 * @caia/wizard-tenant-bootstrap — public exports.
 *
 * Two consumer shapes:
 *
 *   1. `apps/dashboard/lib/tenants/provision.ts` calls `bootstrapTenant()`
 *      from the provisioning fan-out. That's the main entry point.
 *
 *   2. Per-package persistence tests can import `applyMigration` and the
 *      `_migrations_applied` helpers directly for fine-grained control
 *      (e.g. asserting checksum-based re-apply semantics).
 */

export { bootstrapTenant, dropTenantSchema, listTenantTables } from './orchestrator.js';
export { applyMigration, applyManifest, substituteSchema } from './runner.js';
export {
  ensureTrackerTable,
  readTracker,
  recordTracker,
  sqlChecksum,
  TRACKER_TABLE_NAME,
} from './tracker.js';
export { DEFAULT_MANIFEST, getDefaultManifest } from './manifest.js';
export { TENANT_SCHEMA_RE, assertValidTenantSchema, quoteSchema } from './schema.js';
export type {
  BootstrapEventPublisher,
  BootstrapOptions,
  MigrationEntry,
  MigrationOutcome,
  PgPoolLike,
  TenantBootstrapResult,
} from './types.js';
export type { TrackerRow } from './tracker.js';
