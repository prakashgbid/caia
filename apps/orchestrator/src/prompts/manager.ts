import { createHash } from 'crypto';
import { randomUUID } from 'crypto';
import { eq, desc, and, gte, lt, count } from 'drizzle-orm';
import type { Db } from '../db/connection';
import {
  prompts, promptResponses, taskStatusTransitions,
  stories, requirements, tasks as dbTasks, taskRuns, blockers, questions, events,
} from '../db/schema';
import { eventBus } from '../events/bus-adapter';
import type {
  Prompt, PromptResponse, TaskStatusTransition,
  CreatePromptParams, PromptDescendant, PromptJourney,
  PromptListOptions, PromptStatus, TransitionActor,
} from './types';
import { DEFAULT_RUN_MODE, isRunMode, type RunMode } from '../run-modes';

function resolveRunMode(params: CreatePromptParams): RunMode {
  // Prefer the explicit field; fall back to metadata.run_mode for callers
  // that route through metadata (e.g. CLI plan/test commands), and finally
  // default to 'full'. Unknown values fall back to the default rather than
  // throwing — the API route is responsible for validating user input.
  if (params.runMode && isRunMode(params.runMode)) return params.runMode;
  const fromMeta = (params.metadata as Record<string, unknown> | undefined)?.run_mode;
  if (typeof fromMeta === 'string' && isRunMode(fromMeta)) return fromMeta;
  return DEFAULT_RUN_MODE;
}

function makePromptId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const rand = randomUUID().replace(/-/g, '').slice(0, 16);
  return `prm_${ts}_${rand}`;
}

function makeResponseId(): string {
  const ts = Date.now().toString(36).padStart(8, '0');
  const rand = randomUUID().replace(/-/g, '').slice(0, 12);
  return `prr_${ts}_${rand}`;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function createPrompt(db: Db, params: CreatePromptParams): Prompt {
  const hash = sha256(params.body);
  const now = new Date().toISOString();
  const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();

  const existing = db.select().from(prompts)
    .where(and(eq(prompts.hash, hash), gte(prompts.receivedAt, tenSecondsAgo)))
    .get();

  if (existing) return existing as Prompt;

  const id = makePromptId();
  const row = {
    id,
    body: params.body,
    receivedAt: now,
    receivedVia: params.receivedVia ?? 'chat',
    userId: params.userId ?? null,
    sessionId: params.sessionId ?? null,
    correlationId: id,
    hash,
    tokensIn: params.tokensIn ?? null,
    metadataJson: JSON.stringify(params.metadata ?? {}),
    status: 'received' as PromptStatus,
    completedAt: null,
    elapsedMs: null,
    runMode: resolveRunMode(params),
  };

  db.insert(prompts).values(row).run();

  eventBus.publish({
    type: 'prompt.received',
    actor: 'mcp',
    correlation_id: id,
    entity_type: 'prompt',
    entity_id: id,
    payload: {
      prompt_id: id,
      received_via: row.receivedVia,
      session_id: row.sessionId ?? undefined,
      hash,
    },
  });

  // DASH-104: emit canonical pipeline lifecycle event alongside the
  // domain-specific prompt.received. pipeline.started fires once per new
  // prompt and pairs with pipeline.completed / pipeline.failed in
  // updatePromptStatus, giving the dashboard a coarse-grained signal
  // independent of the fine-grained pipeline.stage.advanced stream.
  eventBus.publish({
    type: 'pipeline.started',
    actor: 'mcp',
    correlation_id: id,
    entity_type: 'prompt',
    entity_id: id,
    payload: {
      promptId: id,
      receivedVia: row.receivedVia,
    },
  });

  return row as Prompt;
}

export function getPrompt(db: Db, id: string): (Prompt & { response?: PromptResponse }) | null {
  const prompt = db.select().from(prompts).where(eq(prompts.id, id)).get();
  if (!prompt) return null;

  const response = db.select().from(promptResponses)
    .where(eq(promptResponses.promptId, id))
    .orderBy(desc(promptResponses.respondedAt))
    .get();

  return { ...prompt, response: response ?? undefined } as Prompt & { response?: PromptResponse };
}

export function updatePromptStatus(db: Db, id: string, status: PromptStatus): Prompt | null {
  const existing = db.select().from(prompts).where(eq(prompts.id, id)).get();
  if (!existing) return null;

  const now = new Date().toISOString();
  const patch: Partial<typeof prompts.$inferInsert> = { status };

  if (status === 'answered' || status === 'failed') {
    patch.completedAt = now;
    patch.elapsedMs = Math.round(Date.now() - new Date(existing.receivedAt).getTime());
  }

  db.update(prompts).set(patch).where(eq(prompts.id, id)).run();

  eventBus.publish({
    type: 'prompt.status_changed',
    actor: 'mcp',
    correlation_id: existing.correlationId,
    entity_type: 'prompt',
    entity_id: id,
    payload: {
      prompt_id: id,
      from_status: existing.status,
      to_status: status,
      elapsed_ms: patch.elapsedMs ?? undefined,
    },
  });

  // DASH-104: emit pipeline.completed / pipeline.failed when the prompt
  // reaches a terminal status, giving the dashboard a coarse-grained
  // outcome signal that pairs with the pipeline.started fired at
  // creation time.
  if (status === 'answered') {
    eventBus.publish({
      type: 'pipeline.completed',
      actor: 'mcp',
      correlation_id: existing.correlationId,
      entity_type: 'prompt',
      entity_id: id,
      payload: {
        promptId: id,
        elapsed_ms: patch.elapsedMs ?? undefined,
      },
    });
  } else if (status === 'failed') {
    eventBus.publish({
      type: 'pipeline.failed',
      actor: 'mcp',
      correlation_id: existing.correlationId,
      entity_type: 'prompt',
      entity_id: id,
      severity: 'error',
      payload: {
        promptId: id,
        elapsed_ms: patch.elapsedMs ?? undefined,
        from_status: existing.status,
      },
    });
  }

  return db.select().from(prompts).where(eq(prompts.id, id)).get() as Prompt;
}

export function listPrompts(db: Db, opts: PromptListOptions = {}): Prompt[] {
  const limit = Math.min(opts.limit ?? 50, 200);
  let q = db.select().from(prompts).orderBy(desc(prompts.receivedAt)).limit(limit);

  if (opts.status) q = q.where(eq(prompts.status, opts.status)) as typeof q;
  else if (opts.userId) q = q.where(eq(prompts.userId, opts.userId)) as typeof q;
  else if (opts.since) q = q.where(gte(prompts.receivedAt, opts.since)) as typeof q;
  else if (opts.cursor) q = q.where(lt(prompts.receivedAt, opts.cursor)) as typeof q;

  return q.all() as Prompt[];
}

export function getPromptDescendants(db: Db, promptId: string): PromptDescendant[] {
  const results: PromptDescendant[] = [];

  const storyRows = db.select({
    id: stories.id, title: stories.title, status: stories.status,
    createdAt: stories.createdAt, parentEntityType: stories.parentEntityType,
    parentEntityId: stories.parentEntityId,
  }).from(stories).where(eq(stories.rootPromptId, promptId)).all();

  for (const r of storyRows) {
    results.push({ entityType: 'story', entityId: r.id, title: r.title, status: r.status, createdAt: r.createdAt, parentEntityType: r.parentEntityType, parentEntityId: r.parentEntityId });
  }

  const reqRows = db.select({
    id: requirements.id, title: requirements.title, status: requirements.state,
    createdAt: requirements.createdAt, parentEntityType: requirements.parentEntityType,
    parentEntityId: requirements.parentEntityId,
  }).from(requirements).where(eq(requirements.rootPromptId, promptId)).all();

  for (const r of reqRows) {
    results.push({ entityType: 'requirement', entityId: r.id, title: r.title, status: r.status, createdAt: r.createdAt, parentEntityType: r.parentEntityType, parentEntityId: r.parentEntityId });
  }

  const taskRows = db.select({
    id: dbTasks.id, title: dbTasks.title, status: dbTasks.status,
    createdAt: dbTasks.createdAt, parentEntityType: dbTasks.parentEntityType,
    parentEntityId: dbTasks.parentEntityId,
    startedAt: dbTasks.startedAt,
  }).from(dbTasks).where(eq(dbTasks.rootPromptId, promptId)).all();

  for (const r of taskRows) {
    results.push({ entityType: 'task', entityId: r.id, title: r.title, status: r.status, createdAt: r.createdAt, parentEntityType: r.parentEntityType, parentEntityId: r.parentEntityId });
  }

  const taskRunRows = db.select({
    sessionId: taskRuns.sessionId, title: taskRuns.title, status: taskRuns.status,
    startedAt: taskRuns.startedAt, parentEntityType: taskRuns.parentEntityType,
    parentEntityId: taskRuns.parentEntityId,
  }).from(taskRuns).where(eq(taskRuns.rootPromptId, promptId)).all();

  for (const r of taskRunRows) {
    results.push({ entityType: 'task_run', entityId: r.sessionId, title: r.title, status: r.status, createdAt: r.startedAt, parentEntityType: r.parentEntityType, parentEntityId: r.parentEntityId });
  }

  const blockerRows = db.select({
    id: blockers.id, title: blockers.title, status: blockers.state,
    createdAt: blockers.createdAt, parentEntityType: blockers.parentEntityType,
    parentEntityId: blockers.parentEntityId,
  }).from(blockers).where(eq(blockers.rootPromptId, promptId)).all();

  for (const r of blockerRows) {
    results.push({ entityType: 'blocker', entityId: r.id, title: r.title, status: r.status, createdAt: r.createdAt, parentEntityType: r.parentEntityType, parentEntityId: r.parentEntityId });
  }

  const questionRows = db.select({
    id: questions.id, title: questions.title, status: questions.state,
    createdAt: questions.createdAt, parentEntityType: questions.parentEntityType,
    parentEntityId: questions.parentEntityId,
  }).from(questions).where(eq(questions.rootPromptId, promptId)).all();

  for (const r of questionRows) {
    results.push({ entityType: 'question', entityId: r.id, title: r.title, status: r.status, createdAt: r.createdAt, parentEntityType: r.parentEntityType, parentEntityId: r.parentEntityId });
  }

  return results.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

export function getPromptJourney(db: Db, promptId: string): PromptJourney | null {
  const prompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
  if (!prompt) return null;

  const descendants = getPromptDescendants(db, promptId);

  const countByStatus: Record<string, number> = {};
  for (const d of descendants) {
    countByStatus[d.status] = (countByStatus[d.status] ?? 0) + 1;
  }

  const storiesCount = descendants.filter(d => d.entityType === 'story').length;
  const reqCount = descendants.filter(d => d.entityType === 'requirement').length;
  const taskCount = descendants.filter(d => d.entityType === 'task').length;
  const taskRunCount = descendants.filter(d => d.entityType === 'task_run').length;
  const blockerCount = descendants.filter(d => d.entityType === 'blocker').length;
  const questionCount = descendants.filter(d => d.entityType === 'question').length;

  const taskDescendants = descendants.filter(d => d.entityType === 'task');
  let timeToFirstTaskMs: number | null = null;
  if (taskDescendants.length > 0) {
    const firstTask = taskDescendants[0];
    const taskRow = db.select({ startedAt: dbTasks.startedAt })
      .from(dbTasks).where(eq(dbTasks.id, firstTask.entityId)).get();
    if (taskRow?.startedAt) {
      timeToFirstTaskMs = Math.round(new Date(taskRow.startedAt).getTime() - new Date(prompt.receivedAt).getTime());
    }
  }

  const reworkCount = db.select({ id: taskStatusTransitions.id })
    .from(taskStatusTransitions)
    .where(and(eq(taskStatusTransitions.rootPromptId, promptId), eq(taskStatusTransitions.toStatus, 'rework_queued')))
    .all().length;

  const circuitBreakerEvents = db.select({ id: events.id })
    .from(events)
    .where(and(eq(events.type, 'executor.circuit_opened'), eq(events.correlationId, prompt.correlationId)))
    .all().length;

  const totalEvents = db.select({ id: events.id })
    .from(events)
    .where(eq(events.correlationId, prompt.correlationId))
    .all().length;

  return {
    promptId,
    receivedAt: prompt.receivedAt,
    status: prompt.status as PromptStatus,
    elapsedMs: prompt.elapsedMs,
    timeToFirstTaskMs,
    timeToAllDoneMs: prompt.elapsedMs,
    countByStatus,
    circuitBreakerTrips: circuitBreakerEvents,
    reExecutionCount: reworkCount,
    totalEvents,
    descendants: {
      stories: storiesCount,
      requirements: reqCount,
      tasks: taskCount,
      taskRuns: taskRunCount,
      blockers: blockerCount,
      questions: questionCount,
      total: descendants.length,
    },
  };
}

export function recordTaskTransition(
  db: Db,
  taskId: string,
  toStatus: string,
  actor: TransitionActor,
  opts?: { triggerEventId?: string; notes?: string; rootPromptId?: string },
): TaskStatusTransition {
  const currentTask = db.select({ status: dbTasks.status, rootPromptId: dbTasks.rootPromptId })
    .from(dbTasks).where(eq(dbTasks.id, taskId)).get();

  const fromStatus = currentTask?.status ?? null;
  const rootPromptId = opts?.rootPromptId ?? currentTask?.rootPromptId ?? null;

  const row = {
    taskId,
    fromStatus,
    toStatus,
    transitionedAt: new Date().toISOString(),
    actor,
    triggerEventId: opts?.triggerEventId ?? null,
    notes: opts?.notes ?? null,
    rootPromptId,
  };

  const result = db.insert(taskStatusTransitions).values(row).run();

  eventBus.publish({
    type: 'task.status_changed',
    actor: 'executor',
    correlation_id: rootPromptId ?? taskId,
    entity_type: 'task',
    entity_id: taskId,
    payload: {
      task_id: taskId,
      from_status: fromStatus ?? '',
      to_status: toStatus,
    },
  });

  return { ...row, id: Number(result.lastInsertRowid) } as TaskStatusTransition;
}

export function listTaskTransitions(db: Db, taskId: string): TaskStatusTransition[] {
  return db.select().from(taskStatusTransitions)
    .where(eq(taskStatusTransitions.taskId, taskId))
    .orderBy(taskStatusTransitions.transitionedAt)
    .all() as TaskStatusTransition[];
}

export function createPromptResponse(
  db: Db,
  promptId: string,
  body: string,
  kind: 'decomposition' | 'chat' | 'clarification' | 'error',
  opts?: { tokensOut?: number; decompositionTreeJson?: string },
): PromptResponse {
  const row = {
    id: makeResponseId(),
    promptId,
    responseBody: body,
    respondedAt: new Date().toISOString(),
    responseKind: kind,
    tokensOut: opts?.tokensOut ?? null,
    decompositionTreeJson: opts?.decompositionTreeJson ?? null,
  };
  db.insert(promptResponses).values(row).run();
  return row as PromptResponse;
}
