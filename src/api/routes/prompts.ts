import type { Hono } from 'hono';
import { eq, desc, asc, sql, gte } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { prompts, events, promptPipelineStages, requirements, stories, tasks as dbTasks, taskRuns, dedupResults, entityLabels } from '../../db/schema';
import { eventBus } from '../../events/bus-adapter';
import { nanoid } from 'nanoid';
import {
  createPrompt, getPrompt, listPrompts,
  getPromptDescendants, getPromptJourney,
  listTaskTransitions,
} from '../../prompts/manager';
import type { PromptStatus, PromptReceivedVia, PromptListOptions } from '../../prompts/types';
import { classifyKeyword } from '../../../packages/classifier/src/index';
import { check as dedupCheck } from '../../../packages/dedup-engine/src/index';
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

    // Classify the prompt into functional domains and persist entity labels
    let classificationLabels: string[] = [];
    try {
      const classification = classifyKeyword(prompt.body ?? '');
      classificationLabels = classification.allLabels;
      console.info('[prompts] Prompt classified', { promptId: prompt.id, classification });

      // Determine label type for each label slot
      const labelTypeMap: Record<number, string> = {
        0: 'domain',      // primaryDomain
      };
      // Build label type lookup: nature, complexity, layer get specific types; rest are 'label'
      const natureLike = new Set([classification.nature]);
      const complexityLike = new Set([classification.complexity]);
      const layerLike = new Set([classification.layer]);

      for (const [i, label] of classification.allLabels.entries()) {
        let labelType = 'label';
        if (i === 0) labelType = 'domain';
        else if (natureLike.has(label as never)) labelType = 'nature';
        else if (complexityLike.has(label as never)) labelType = 'complexity';
        else if (layerLike.has(label as never)) labelType = 'layer';

        db.insert(entityLabels).values({
          id: `el-${nanoid()}`,
          entityKind: 'prompt',
          entityId: prompt.id,
          labelSlug: label,
          labelType,
          confidence: classification.confidence,
          source: 'classifier',
          createdAt: Date.now(),
        }).run();
      }
    } catch { /* never break prompt creation */ }

    // Run dedup check against recent prompts (last 6 months)
    let dedupDecision: string = 'unchecked';
    try {
      const sixMonthsAgo = new Date(Date.now() - (180 * 24 * 60 * 60 * 1000)).toISOString();
      const recentPrompts = db.select({
        id: prompts.id,
        body: prompts.body,
        receivedAt: prompts.receivedAt,
      }).from(prompts)
        .where(gte(prompts.receivedAt, sixMonthsAgo))
        .limit(200)
        .all();

      const corpus = recentPrompts.map(p => ({
        id: p.id,
        title: p.body ?? '',
        description: p.body ?? '',
        createdAt: new Date(p.receivedAt ?? Date.now()).getTime(),
        labels: classificationLabels,
      }));

      const dedupResult = dedupCheck(
        { id: prompt.id, title: prompt.body ?? '', description: prompt.body ?? '', labels: classificationLabels },
        corpus
      );

      dedupDecision = dedupResult.decision;

      db.insert(dedupResults).values({
        id: `dedup-${nanoid()}`,
        entityKind: 'prompt',
        entityId: prompt.id,
        checkedAt: Date.now(),
        decision: dedupResult.decision,
        similarityScore: dedupResult.confidence,
        similarEntities: JSON.stringify(dedupResult.similarItems.slice(0, 5)),
        recommendations: JSON.stringify(dedupResult.recommendations),
        createdAt: Date.now(),
      }).run();

      console.info('[prompts] Dedup check complete', {
        promptId: prompt.id,
        decision: dedupResult.decision,
        confidence: dedupResult.confidence,
        shouldBlock: dedupResult.shouldBlock,
        shouldWarn: dedupResult.shouldWarn,
      });
    } catch (err) {
      console.error('[prompts] Dedup check failed (non-fatal):', err);
    }

    // Run scaffolder asynchronously — determines agent team and broadcasts context
    const projectId = (body.metadata?.projectId as string | null) ?? null;
    runScaffolder(prompt.id, prompt.body ?? '', projectId, db).catch((e) => {
      console.warn('[prompts] Scaffolder failed', { err: e, promptId: prompt.id });
    });

    return c.json({
      prompt_id: prompt.id,
      correlation_id: prompt.correlationId,
      dedup_decision: dedupDecision,
    }, 201);
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

  // GET /prompts/:id/dedup — get the most recent dedup result for a prompt
  app.get('/prompts/:id/dedup', async (c) => {
    const id = c.req.param('id');
    const [result] = db.select().from(dedupResults)
      .where(eq(dedupResults.entityId, id))
      .orderBy(desc(dedupResults.checkedAt))
      .limit(1)
      .all();
    return result ? c.json(result) : c.json({ decision: 'unchecked' });
  });
}
