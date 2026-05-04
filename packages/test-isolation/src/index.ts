/**
 * @chiefaia/test-isolation
 *
 * Per-test isolation primitives for parallel test runs.
 *
 *   - {@link createTestDb}    — per-test ephemeral SQLite (FIX-008)
 *   - {@link allocateTestPort} — per-test localhost ports (FIX-009)
 *   - {@link listLiveTestDbs}, {@link listClaimedTestPorts} — observability
 *
 * Each module is also reachable directly:
 *
 *   import { createTestDb }     from '@chiefaia/test-isolation/sqlite';
 *   import { allocateTestPort } from '@chiefaia/test-isolation/ports';
 */

export {
  createTestDb,
  listLiveTestDbs,
  sweepStaleTestDbs,
} from './sqlite.js';
export type { CreateTestDbOptions, TestDb } from './sqlite.js';

export {
  allocateTestPort,
  allocateTestPortRange,
  releaseTestPort,
  listClaimedTestPorts,
  deriveStartPort,
  DEFAULT_PORT_FLOOR,
  DEFAULT_PORT_CEILING,
} from './ports.js';
export type {
  AllocateTestPortOptions,
  AllocateTestPortRangeOptions,
} from './ports.js';
