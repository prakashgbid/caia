/**
 * High-level orchestrator: graph -> bucketer -> dispatcher.
 *
 * `schedule()` is the single function the api.ts handler + the smoke test
 * call. It:
 *
 *   1. Builds the dependency graph.
 *   2. Detects cycles — if any, short-circuits with cycles surfaced in
 *      the ScheduleResult (no transitions, no dispatches).
 *   3. Runs the bucketer to produce a WavePlan.
 *   4. For each wave (in order), dispatches every bucket's tickets in
 *      parallel via Dispatcher.
 *   5. Collects per-ticket DispatchAttempts, TransitionResults, and a
 *      failures list, and returns the typed ScheduleResult.
 *
 * Sequential-after buckets run *after* the predecessor bucket inside the
 * same wave finishes. Parallel buckets within a wave run together.
 */

import { bucketTickets } from './bucketer.js';
import { buildDependencyGraph, detectCycles } from './dependency-graph.js';
import { Dispatcher } from './dispatcher.js';
import type {
  DispatchAttempt,
  ScheduleInput,
  ScheduleResult,
  SchedulerConfig,
  Ticket,
  TransitionResult,
  WaveBucket,
} from './types.js';

const DEFAULT_DRY_RUN_WORKER = 'dry-run-worker';

export async function schedule(
  input: ScheduleInput,
  config: SchedulerConfig,
): Promise<ScheduleResult> {
  // 1. Build graph + detect cycles.
  const graph = buildDependencyGraph(input.tickets);
  const cycleReport = detectCycles(graph);
  if (cycleReport.cycles.length > 0) {
    // Drive scheduling-failed on every project touched by a cycle.
    const transitions: TransitionResult[] = [];
    const failures: { ticketId: string; reason: string }[] = [];
    for (const cycle of cycleReport.cycles) {
      for (const ticketId of cycle.nodes) {
        const projectId = input.projectIdByTicket[ticketId];
        if (!projectId) continue;
        try {
          const t = await config.stateMachine.transition(projectId, 'scheduling-failed', {
            reason: `dependency cycle includes ${ticketId}`,
            triggeredBy: input.triggeredBy ?? {
              kind: 'agent',
              id: '@caia/principal-engineer',
            },
            payload: { ticketId, cycleNodes: cycle.nodes.slice() },
          });
          transitions.push(t);
        } catch (err) {
          failures.push({
            ticketId,
            reason: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
    return Object.freeze({
      wavePlan: Object.freeze({
        buckets: Object.freeze([] as readonly WaveBucket[]),
        waveCount: 0,
        perWaveCap: 0,
      }),
      dispatched: Object.freeze([] as readonly DispatchAttempt[]),
      transitions: Object.freeze(transitions),
      failures: Object.freeze(failures),
      cycles: cycleReport.cycles,
    });
  }

  // 2. Bucket.
  const bucketInput: Parameters<typeof bucketTickets>[0] = {
    tickets: input.tickets,
    tenantTier: input.tenantTier,
    ...(input.tenantOverrideCap !== undefined
      ? { tenantOverrideCap: input.tenantOverrideCap }
      : {}),
    ...(input.bucketPolicies !== undefined
      ? { bucketPolicies: input.bucketPolicies }
      : {}),
  };
  const wavePlan = bucketTickets(bucketInput);

  // 3. Dispatch.
  const workerIds =
    config.workerIds && config.workerIds.length > 0
      ? config.workerIds
      : [DEFAULT_DRY_RUN_WORKER];

  const dispatcherOpts: ConstructorParameters<typeof Dispatcher>[0] = {
    stateMachine: config.stateMachine,
    spawnFn: config.spawnFn,
    fseSubagentPath: config.fseSubagentPath,
    workerIds,
    spawnTimeoutMs: config.spawnTimeoutMs ?? 30 * 60 * 1000,
    dryRun: config.dryRun ?? false,
    ...(input.triggeredBy !== undefined ? { triggeredBy: input.triggeredBy } : {}),
  };
  const dispatcher = new Dispatcher(dispatcherOpts);

  const ticketsById = new Map<string, Ticket>();
  for (const t of input.tickets) ticketsById.set(t.ticketId, t);

  const dispatched: DispatchAttempt[] = [];
  const transitions: TransitionResult[] = [];
  const failures: { ticketId: string; reason: string }[] = [];

  // Group buckets by wave so we can sequence waves but parallelise buckets
  // within a wave. Within a wave, we run parallel-bucket-N concurrently,
  // then sequential-after buckets after the parallel-N predecessor.
  const bucketsByWave = new Map<number, WaveBucket[]>();
  for (const b of wavePlan.buckets) {
    const arr = bucketsByWave.get(b.waveIndex) ?? [];
    arr.push(b);
    bucketsByWave.set(b.waveIndex, arr);
  }
  const waveKeys = Array.from(bucketsByWave.keys()).sort((a, b) => a - b);

  for (const wave of waveKeys) {
    const buckets = bucketsByWave.get(wave) ?? [];
    const parallel = buckets.filter((b) => b.assignment.kind === 'parallel-bucket');
    const sequential = buckets.filter((b) => b.assignment.kind === 'sequential-after');

    // Parallel buckets fire concurrently.
    const parallelResults = await Promise.all(
      parallel.map((b) =>
        dispatcher.dispatchBucket(b, ticketsById, input.projectIdByTicket),
      ),
    );
    for (const arr of parallelResults) {
      for (const a of arr) {
        dispatched.push(a);
        if (a.transition) transitions.push(a.transition);
        if (!a.ok) {
          failures.push({
            ticketId: a.ticketId,
            reason: a.failureReason ?? a.diagnostic ?? 'spawn-failed',
          });
        }
      }
    }

    // Sequential buckets fire serially.
    for (const b of sequential) {
      const arr = await dispatcher.dispatchBucket(
        b,
        ticketsById,
        input.projectIdByTicket,
      );
      for (const a of arr) {
        dispatched.push(a);
        if (a.transition) transitions.push(a.transition);
        if (!a.ok) {
          failures.push({
            ticketId: a.ticketId,
            reason: a.failureReason ?? a.diagnostic ?? 'spawn-failed',
          });
        }
      }
    }
  }

  return Object.freeze({
    wavePlan,
    dispatched: Object.freeze(dispatched),
    transitions: Object.freeze(transitions),
    failures: Object.freeze(failures),
    cycles: cycleReport.cycles,
  });
}
