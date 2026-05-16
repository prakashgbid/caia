/**
 * @chiefaia/sqlite-utils
 *
 * Shared SQLite helpers for CAIA packages — better-sqlite3 wrappers
 * for opening WAL-mode databases, applying idempotent file-based
 * migrations, running scoped transactions, and caching prepared
 * statements.
 *
 * Lifted from the most-complete sites (mentor-event-bus opens DB +
 * migrations; librarian / mentor-retrieval index stores share the
 * pragma constellation; llm-cache / local-rag share the in-class
 * statement caching idea). Centralising these four primitives means
 * a future change (e.g. a global `busy_timeout` or a new pragma)
 * lands once instead of in nine places.
 */

export { openDb, type OpenDbOptions } from './open.js';
export {
  migrate,
  isMigrationsInitialised,
  listAppliedMigrations,
  type MigrateOptions,
  type MigrationReport,
} from './migrate.js';
export {
  withTransaction,
  type TransactionMode,
  type WithTransactionOptions,
} from './transaction.js';
export {
  prepareCachedStmt,
  clearPreparedStmtCache,
  preparedStmtCacheSize,
} from './prepare-cache.js';

// Re-export the better-sqlite3 Database type for downstream type-only
// imports. Consumers can `import type { Database } from '@chiefaia/sqlite-utils'`
// without taking a direct dep on `better-sqlite3`'s types package, though
// taking that dep directly is also fine and is what most consumers do.
export type { Database } from 'better-sqlite3';
