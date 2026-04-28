/**
 * Task Scheduler Agent — Tier 2
 *
 * Runs after the BA Agent completes enrichment.
 * Analyses inter-task dependencies and organises work into:
 *  - sequentialTasks  : full topological order (one flat array)
 *  - parallelBuckets  : groups of tasks that share no dependencies and
 *                       can be executed concurrently within each bucket
 *
 * Uses Kahn's algorithm for a deterministic topological sort.
 * Writes positionOrdinal back to the DB so the executor respects ordering.
 */

import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { tasks } from '../db/schema';
import { eq } from 'drizzle-orm';

export interface SchedulerInput {
  promptId: string;
  correlationId: string;
}

export interface SchedulerOutput {
  promptId: string;
  sequentialTasks: string[];    // task IDs in topological order
  parallelBuckets: string[][];  // sub-groups that can run concurrently per level
  totalTasks: number;
  estimatedWallclockHours: number;
}

// ─── Dependency Graph ─────────────────────────────────────────────────────────

/**
 * Builds an adjacency list: taskId → [ids of tasks it depends on].
 * Gracefully handles malformed JSON in dependsOn.
 */
function buildDependencyGraph(
  taskList: Array<typeof tasks.$inferSelect>,
): Map<string, string[]> {
  const graph = new Map<string, string[]>();
  for (const task of taskList) {
    let deps: string[] = [];
    try {
      const parsed = JSON.parse(task.dependsOn ?? '[]');
      if (Array.isArray(parsed)) deps = parsed.filter((d): d is string => typeof d === 'string');
    } catch {
      /* malformed JSON — treat as no deps */
    }
    graph.set(task.id, deps);
  }
  return graph;
}

// ─── Topological Sort (Kahn's algorithm) ─────────────────────────────────────

interface SortResult {
  sequential: string[];     // all IDs in topological order
  parallel: string[][];     // levels — each level contains IDs with no unresolved deps
}

/**
 * Kahn's BFS topological sort.
 * Each iteration produces one "level" of tasks — all tasks in a level have had
 * their dependencies resolved in prior levels, so they can run in parallel.
 *
 * Cycles are silently tolerated: any IDs not reachable via the DAG are appended
 * at the end so no task is silently dropped.
 */
function topologicalSort(graph: Map<string, string[]>): SortResult {
  const ids = [...graph.keys()];

  // in-degree = number of tasks that depend on this task
  // We actually want: how many of *my* dependencies haven't been processed yet.
  // Re-interpret: inDegree[id] = number of deps[id] entries not yet visited.
  const inDegree = new Map<string, number>();
  for (const id of ids) {
    inDegree.set(id, (graph.get(id) ?? []).length);
  }

  const visited = new Set<string>();
  const levels: string[][] = [];

  // Seed: tasks with zero dependencies
  let frontier = ids.filter(id => (inDegree.get(id) ?? 0) === 0);

  while (frontier.length > 0) {
    levels.push(frontier);
    frontier.forEach(id => visited.add(id));

    const next: string[] = [];
    for (const [candidate, deps] of graph) {
      if (visited.has(candidate)) continue;
      // Re-count unresolved deps after this level
      const unresolved = deps.filter(d => !visited.has(d)).length;
      if (unresolved === 0) next.push(candidate);
    }

    // Deduplicate — a candidate might qualify after multiple items in this level
    frontier = [...new Set(next)];
  }

  // Append any unvisited IDs (cycle members) at the end
  const orphans = ids.filter(id => !visited.has(id));
  if (orphans.length > 0) levels.push(orphans);

  const sequential = levels.flat();
  // Only expose levels with >1 task as "parallelBuckets"; singletons are serial
  const parallel = levels.filter(lvl => lvl.length > 1);

  return { sequential, parallel };
}

// ─── Wall-clock Estimate ─────────────────────────────────────────────────────

/**
 * Rough heuristic: 2 engineering hours per task, reduced by the average
 * parallelism available across all parallel-capable levels.
 */
function estimateWallclock(totalTasks: number, parallelBuckets: string[][]): number {
  if (totalTasks === 0) return 0;

  const avgParallelism =
    parallelBuckets.length > 0
      ? parallelBuckets.reduce((sum, bucket) => sum + bucket.length, 0) /
        parallelBuckets.length
      : 1;

  return (totalTasks * 2) / Math.max(avgParallelism, 1);
}

// ─── Main Agent Runner ────────────────────────────────────────────────────────

export async function runTaskScheduler(
  input: SchedulerInput,
  db: ReturnType<typeof getDb>,
): Promise<SchedulerOutput> {
  const { promptId, correlationId } = input;

  // Fetch all tasks for this prompt directly via rootPromptId
  const allTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.rootPromptId, promptId));

  if (allTasks.length === 0) {
    return {
      promptId,
      sequentialTasks: [],
      parallelBuckets: [],
      totalTasks: 0,
      estimatedWallclockHours: 0,
    };
  }

  const graph = buildDependencyGraph(allTasks);
  const { sequential, parallel: parallelBuckets } = topologicalSort(graph);
  const estimatedWallclockHours = estimateWallclock(allTasks.length, parallelBuckets);

  // Persist the execution order back to the DB via positionOrdinal.
  // positionOrdinal = position in the sequential array (lower = earlier).
  // priorityScore stays untouched — the priority engine owns that field.
  for (let i = 0; i < sequential.length; i++) {
    await db
      .update(tasks)
      .set({ positionOrdinal: i })
      .where(eq(tasks.id, sequential[i]))
      .catch(() => { /* non-fatal — scheduler proceeds */ });
  }

  // Emit scheduling-complete event
  eventBus.publish({
    type: 'task-scheduler.scheduling.complete',
    actor: 'task-scheduler',
    correlation_id: correlationId,
    entity_type: 'prompt',
    entity_id: promptId,
    payload: {
      promptId,
      correlationId,
      totalTasks: allTasks.length,
      sequentialCount: sequential.length,
      parallelBucketCount: parallelBuckets.length,
      estimatedWallclockHours,
    },
  });

  return {
    promptId,
    sequentialTasks: sequential,
    parallelBuckets,
    totalTasks: allTasks.length,
    estimatedWallclockHours,
  };
}
