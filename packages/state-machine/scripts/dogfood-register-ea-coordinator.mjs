#!/usr/bin/env node
/**
 * Dogfood: register the EA Coordinator framework build (sibling task)
 * as the first `Solution` entity in production.
 *
 * Usage:
 *   PG_DSN=postgresql://… node scripts/dogfood-register-ea-coordinator.mjs
 *
 * Requires `0002_solution_lifecycle.sql` to be applied on the target db
 * (PgSolutionStore.init() will apply it idempotently if not already).
 *
 * Idempotent — re-running with the same solution_id throws
 * DuplicateSolutionIdError (which we catch + report as "already
 * registered"). Re-runs after that point are no-ops.
 */

import { Pool } from 'pg';
import {
  DuplicateSolutionIdError,
  PgSolutionStore,
  SolutionLifecycleMachine,
} from '../dist/index.js';

const PG_DSN = process.env.PG_DSN;
if (!PG_DSN) {
  console.error('PG_DSN env var is required (postgresql://user:pw@host:port/db).');
  process.exit(2);
}

const pool = new Pool({ connectionString: PG_DSN });
const store = new PgSolutionStore(pool);
const machine = new SolutionLifecycleMachine(store);
await machine.init(); // applies 0002_solution_lifecycle.sql if not yet applied

try {
  const reg = await machine.registerSolution({
    solutionId: 'caia-2026-05-24-ea-coordinator-framework',
    title: 'EA Coordinator Framework build (17-architect roster aggregation + sign-off composer)',
    planPath: 'research/ea_coordinator_framework_2026.md',
    approvedByAdr: 'ADR-035', // ADR-035 is the state-machine package ADR; the
                              // coordinator-specific ADR will be filed by the
                              // EA Agent on the coordinator-build's submitPlan.
    manifestPointer:
      'agent-memory/solutions_manifest.yaml#/solutions/caia-2026-05-24-ea-coordinator-framework',
    initialPayload: {
      dogfood: true,
      dogfooded_at: new Date().toISOString(),
      purpose:
        'First Solution entity in production — proves the FSM works on a real, in-flight build before we wire the four stewards behind it.',
    },
  });
  console.log(JSON.stringify({ result: 'registered', solutionId: reg.solutionId, state: reg.currentState }, null, 2));
} catch (err) {
  if (err instanceof DuplicateSolutionIdError) {
    const snap = await machine.getSolutionLifecycle(err.solutionId);
    console.log(JSON.stringify({
      result: 'already-registered',
      solutionId: err.solutionId,
      currentState: snap.solution.status,
      ageHoursInState: snap.ageHoursInState,
      historyLength: snap.history.length,
    }, null, 2));
  } else {
    console.error('register failed:', err);
    process.exit(1);
  }
}

await pool.end();
