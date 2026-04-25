/**
 * Reprioritizer — the orchestrating engine.
 *
 * - scoreOne(taskId)  → score + persist + audit + emit events
 * - scoreAll()        → batch rescore all non-terminal tasks
 * - subscribeToEvents() → wire event-bus triggers for continuous reprioritization
 */

import { eq, inArray, and, notInArray } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { getSqliteRaw } from '../db/connection';
import { tasks, blockers, priorityAudit } from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import { scoreTask } from './scorer';
import { computeOrdinal } from './placer';
import type { TaskScoringContext, PrioritizeResult } from './types';

const TERMINAL_STATUSES = ['done', 'completed', 'failed', 'cancelled'];

function now(): string {
  return new Date().toISOString();
}

function buildContext(
  task: typeof tasks.$inferSelect,
  dependentCount: number,
  openBlockerCount: number,
): TaskScoringContext {
  return {
    id: task.id,
    title: task.title,
    domainSlug: task.domainSlug,
    declaredFiles: JSON.parse(task.declaredFiles) as string[],
    notes: task.notes,
    dependsOn: JSON.parse(task.dependsOn) as string[],
    dependentCount,
    openBlockerCount,
    currentScore: task.priorityScore,
    currentBucket: task.priorityBucket,
    currentOrdinal: task.positionOrdinal,
  };
}

function countDependents(taskId: string, db: Db): number {
  const sqlite = getSqliteRaw();
  const row = sqlite.prepare(
    `SELECT COUNT(*) as cnt FROM tasks WHERE json_extract(depends_on, '$') IS NOT NULL AND depends_on LIKE ?`
  ).get(`%"${taskId}"%`) as { cnt: number } | undefined;
  return row?.cnt ?? 0;
}

function getDepOrdinals(depIds: string[], db: Db): number[] {
  if (depIds.length === 0) return [];
  const rows = db.select({ positionOrdinal: tasks.positionOrdinal })
    .from(tasks)
    .where(inArray(tasks.id, depIds))
    .all();
  return rows.map(r => r.positionOrdinal);
}

function countOpenBlockers(taskId: string, db: Db): number {
  const rows = db.select({ id: blockers.id })
    .from(blockers)
    .where(and(eq(blockers.taskId, taskId), eq(blockers.state, 'open')))
    .all();
  return rows.length;
}

export async function scoreOne(taskId: string, db: Db, actor = 'system'): Promise<PrioritizeResult | null> {
  const task = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!task) return null;

  const depIds = JSON.parse(task.dependsOn) as string[];
  const dependentCount = countDependents(taskId, db);
  const openBlockerCount = countOpenBlockers(taskId, db);

  const ctx = buildContext(task, dependentCount, openBlockerCount);
  const rationale = scoreTask(ctx);
  const depOrdinals = getDepOrdinals(depIds, db);
  const positionOrdinal = computeOrdinal(rationale.bucket, rationale.score, depOrdinals);

  const prevScore = task.priorityScore;
  const prevBucket = task.priorityBucket;
  const prevOrdinal = task.positionOrdinal;

  // Persist
  db.update(tasks).set({
    priorityScore: rationale.score,
    priorityBucket: rationale.bucket,
    positionOrdinal,
    priorityRationaleJson: JSON.stringify(rationale),
    lastPrioritizedAt: now(),
  }).where(eq(tasks.id, taskId)).run();

  // Audit row
  db.insert(priorityAudit).values({
    taskId,
    oldScore: prevScore,
    newScore: rationale.score,
    oldBucket: prevBucket,
    newBucket: rationale.bucket,
    reason: rationale.summary,
    actor,
    changedAt: now(),
  }).run();

  // Events
  eventBus.publish({
    type: 'priority.scored',
    actor: 'prioritizer',
    entity_type: 'task',
    entity_id: taskId,
    payload: {
      task_id: taskId,
      score: rationale.score,
      bucket: rationale.bucket,
      rationale_summary: rationale.summary,
    },
  });

  if (prevBucket !== rationale.bucket) {
    eventBus.publish({
      type: 'priority.rebucketed',
      actor: 'prioritizer',
      entity_type: 'task',
      entity_id: taskId,
      payload: {
        task_id: taskId,
        old_bucket: prevBucket,
        new_bucket: rationale.bucket,
        score: rationale.score,
      },
    });

    // P0 pause-lower-bucket signal: emit decision event
    if (rationale.bucket === 'P0' && prevBucket !== 'P0') {
      eventBus.publish({
        type: 'system.decision_made',
        actor: 'prioritizer',
        entity_type: 'task',
        entity_id: taskId,
        payload: {
          component: 'reprioritizer',
          decision: `Task ${taskId} promoted to P0`,
          rationale: rationale.summary,
        },
      });
    }
  }

  if (prevOrdinal !== positionOrdinal) {
    eventBus.publish({
      type: 'priority.reordered',
      actor: 'prioritizer',
      entity_type: 'task',
      entity_id: taskId,
      payload: {
        task_id: taskId,
        old_ordinal: prevOrdinal,
        new_ordinal: positionOrdinal,
        bucket: rationale.bucket,
      },
    });
  }

  return {
    taskId,
    score: rationale.score,
    bucket: rationale.bucket,
    positionOrdinal,
    rationale,
    previousScore: prevScore,
    previousBucket: prevBucket,
  };
}

export async function scoreAll(db: Db, actor = 'system'): Promise<PrioritizeResult[]> {
  const allTasks = db.select({
    id: tasks.id,
    status: tasks.status,
  }).from(tasks)
    .where(notInArray(tasks.status, TERMINAL_STATUSES))
    .all();

  const results: PrioritizeResult[] = [];
  for (const t of allTasks) {
    const result = await scoreOne(t.id, db, actor);
    if (result) results.push(result);
  }

  eventBus.publish({
    type: 'system.decision_made',
    actor: 'prioritizer',
    payload: {
      component: 'reprioritizer',
      decision: `Batch rescore completed: ${results.length} tasks`,
      rationale: `scoreAll() triggered by ${actor}`,
    },
  });

  return results;
}

export function subscribeToEvents(db: Db): () => void {
  const unsubs: Array<() => void> = [];

  // Re-score affected tasks when completeness findings are filed
  unsubs.push(eventBus.subscribe('completeness.finding_filed', (ev) => {
    const entityId = ev.entity_id;
    if (entityId) {
      scoreOne(entityId, db, 'prioritizer').catch(() => {});
    }
  }));

  // Re-score when a task status changes (e.g., a dep completes → unblock others)
  unsubs.push(eventBus.subscribe('task.status_changed', (ev) => {
    const taskId = ev.entity_id;
    if (!taskId) return;

    // Re-score the changed task
    scoreOne(taskId, db, 'prioritizer').catch(() => {});

    // Re-score tasks that depend on this one (their dep-ordinals may shift)
    const sqlite = getSqliteRaw();
    const dependents = sqlite.prepare(
      `SELECT id FROM tasks WHERE depends_on LIKE ? AND status NOT IN ('done','completed','failed','cancelled')`
    ).all(`%"${taskId}"%`) as Array<{ id: string }>;

    for (const dep of dependents) {
      scoreOne(dep.id, db, 'prioritizer').catch(() => {});
    }
  }));

  // Re-score when a new task is created
  unsubs.push(eventBus.subscribe('task.created', (ev) => {
    const taskId = ev.entity_id;
    if (taskId) {
      scoreOne(taskId, db, 'prioritizer').catch(() => {});
    }
  }));

  return () => unsubs.forEach(u => u());
}
