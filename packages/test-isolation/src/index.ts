/**
 * @chiefaia/test-isolation
 *
 * Per-test isolation primitives for parallel test runs (FIX-008+).
 *
 *   - {@link createTestDb} — per-test ephemeral SQLite (FIX-008)
 *   - {@link listLiveTestDbs}, {@link sweepStaleTestDbs} — observability hooks
 *
 * Each module is also reachable directly:
 *
 *   import { createTestDb } from '@chiefaia/test-isolation/sqlite';
 */

export { createTestDb, listLiveTestDbs, sweepStaleTestDbs } from './sqlite.js';
export type { CreateTestDbOptions, TestDb } from './sqlite.js';
