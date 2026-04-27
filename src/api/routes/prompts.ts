import type { Hono } from 'hono';
import { eq, desc, asc, sql } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { prompts, events, promptPipelineStages, requirements, stories, tasks as dbTasks, taskRuns } from '../../db/schema';
import { eventBus } from '../../events/bus-adapter';
import { nanoid } from 'nanoid';
import {
  createPrompt, getPrompt, listPrompts,
  getPromptDescendants, getPromptJourney,
  listTaskTransitions,
} from '../../prompts/manager';
import type { PromptStatus, PromptReceivedVia, PromptListOptions } from '../../prompts/types';
import { classifyKeyword } from '../../../packages/classifier/src/index';
import { runScaffolder } from '../../agents/scaffolder';

// @no-events — route registration wrapper; business events are emitted by manager functions
export function registerPromptsRoutes(app: Hono, db: Db): void {
  // Create a new prompt (idempotent by hash in 10s window)
  app.post('/prompts', async (c) => {
    const body = await c.req.json() as {
      body: string;
      received_via?: string;
      session_id?: string;
      user_id?: string;
      tokens_in?: number;
      metadata?: Record<string, unknown>;
    };

    if (!body.body || typeof body.body !== 'string') {
      return c.json({ error: 'body is required' }, 400);
    }

    const prompt = createPrompt(db, {
      body: body.body,
      receivedVia: (body.received_via ?? 'api') as PromptReceivedVia,
      sessionId: body.session_id,
      userId: body.user_id,
      tokensIn: body.tokens_in,
      metadata: body.metadata,
    });

    // Emit prompt.ingested event and create pipeline stage tracking
    try {
      eventBus.publish({
        type: 'prompt.ingested',
        actor: 'api',
        correlation_id: prompt.id,
        entity_type: 'prompt',
        entity_id: prompt.id,
        payload: {
          promptId: prompt.id,
          text: prompt.body ?? '',
          projectId: (body.metadata?.projectId as string | null) ?? null,
          source: body.received_via ?? 'api',
        },
      });

      db.insert(promptPipelineStages).values({
        id: 'pps_' + nanoid(8),
        promptId: prompt.id,
        stage: 'ingested',
        entityKind: 'prompt',
        entityId: prompt.id,
        enteredAt: Date.now(),
      }).run();
    } catch (err) {
      console.error('[prompts] Failed to emit ingested event or insert pipeline stage:', err);
    }

    // Classify the prompt into functional domains and assign labels
    try {
      const classification = classifyKeyword(prompt.body ?? '');
      console.info('[prompts] Prompt classified', { promptId: prompt.id, classification });
    } catch { /* never break prompt creation */ }

    // Run scaffolder asynchronously — determines agent team and broadcasts context
    const projectId = (body.metadata?.projectId as string | null) ?? null;
    runScaffolder(prompt.id, prompt.body ?? '', projectId, db).catch((e) => {
      console.warn('[prompts] Scaffolder failed', { err: e, promptId: prompt.id });
    });

    return c.json({ prompt_id: prompt.id, correlation_id: prompt.correlationId }, 201);
  });

  // List prompts with optional filters
  app.get('/prompts', (c) => {
    const { since, user_id, status, limit, cursor } = c.req.query() as Record<string, string>;
    const opts: PromptListOptions = {
      since: since || undefined,
      userId: user_id || undefined,
      status: status ? (status as PromptStatus) : undefined,
      limit: limit ? parseInt(limit, 10) : 50,
      cursor: cursor || undefined,
    };
    const rows = listPrompts(db, opts);
    return c.json({ prompts: rows, total: rows.length });
  });

  // Get a single prompt with its response and top-level descendants
  app.get('/prompts/:id', (c) => {
    const { id } = c.req.param();
    const result = getPrompt(db, id);
    if (!result) return c.json({ error: 'not found' }, 404);

    const descendants = getPromptDescendants(db, id);
    return c.json({ prompt: result, descendants_count: descendants.length });
  });

  // Recursive descendant tree with current status + timing
  app.get('/prompts/:id/descendants', (c) => {
    const { id } = c.req.param();
    const prompt = getPrompt(db, id);
    if (!prompt) return c.json({ error: 'not found' }, 404);

    const descendants = getPromptDescendants(db, id);
    return c.json({ prompt_id: id, descendants, total: descendants.length });
  });

  // Aggregated journey view
  app.get('/prompts/:id/journey', (c) => {
    const { id } = c.req.param();
    const journey = getPromptJourney(db, id);
    if (!journey) return c.json({ error: 'not found' }, 404);
    return c.json(journey);
  });

  // Events filtered by correlation_id
  app.get('/prompts/:id/events', (c) => {
    const { id } = c.req.param();
    const prompt = getPrompt(db, id);
    if (!prompt) return c.json({ error: 'not found' }, 404);

    const { limit } = c.req.query() as Record<string, string>;
    const n = limit ? parseInt(limit, 10) : 200;

    const rows = db.select().from(events)
      .where(eq(events.correlationId, prompt.correlationId))
      .orderBy(desc(events.occurredAt))
      .limit(n)
      .all();

    return c.json({ events: rows, total: rows.length, correlation_id: prompt.correlationId });
  });

  // Task status transitions
  app.get('/tasks/:id/transitions', (c) => {
    const { id } = c.req.param();
    const transitions = listTaskTransitions(db, id);
    return c.json({ task_id: id, transitions, total: transitions.length });
  });

  // Get prompt with full pipeline visualization
  app.get('/prompts/:id/pipeline', async (c) => {
    const promptId = c.req.param('id');

    const prompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
    if (!prompt) return c.json({ error: 'Not found' }, 404);

    // Get all pipeline stages for this prompt
    const stages = db.select().from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, promptId))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();

    // Get all requirements linked to this prompt
    const reqs = db.select().from(requirements)
      .where(eq(requirements.rootPromptId, promptId))
      .all();

    // Build tree: requirements -> stories -> tasks -> task_runs
    const tree = await Promise.all(reqs.map(async (req) => {
      const reqStories = db.select().from(stories)
        .where(eq(stories.rootPromptId, promptId))
        .all()
        .filter(_s => {
          // stories from this requirement context
          return true; // In real scenario, would track parentage
        });

      const storiesWithTasks = await Promise.all(reqStories.map(async (story) => {
        const storyTasks = db.select().from(dbTasks)
          .where(eq(dbTasks.parentEntityId, story.id))
          .all();

        const tasksWithRuns = await Promise.all(storyTasks.map(async (task) => {
          const runs = db.select().from(taskRuns)
            .where(eq(taskRuns.parentEntityId, task.id))
            .orderBy(asc(taskRuns.startedAt))
            .all();
          return { ...task, taskRuns: runs };
        }));

        return { ...story, tasks: tasksWithRuns };
      }));

      return { ...req, stories: storiesWithTasks };
    }));

    // Get related events
    const relatedEvents = db.select().from(events)
      .where(
        sql`(json_extract(${events.payloadJson}, '$.promptId') = ${promptId}
             OR json_extract(${events.payloadJson}, '$.rootPromptId') = ${promptId}
             OR ${events.correlationId} = ${promptId})`
      )
      .orderBy(asc(events.occurredAt))
      .limit(500)
      .all();

    // Compute summary statistics
    const allRuns = tree.flatMap(r => r.stories.flatMap(s => s.tasks.flatMap(t => t.taskRuns)));
    const summary = {
      totalDurationMs: stages.length > 0 ? Date.now() - stages[0].enteredAt : null,
      totalInputTokens: allRuns.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
      totalOutputTokens: allRuns.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
      filesChanged: [...new Set(allRuns.flatMap(r => {
        try {
          return r.filesChanged ? JSON.parse(r.filesChanged) : [];
        } catch {
          return [];
        }
      }))],
      requirementCount: reqs.length,
      taskCount: tree.flatMap(r => r.stories.flatMap(s => s.tasks)).length,
      taskRunCount: allRuns.length,
    };

    return c.json({ prompt, stages, requirements: tree, events: relatedEvents, summary });
  });
}
