import type { Hono } from 'hono';
import { eq, desc, asc, sql, gte } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { prompts, events, promptPipelineStages, requirements, stories, tasks as dbTasks, taskRuns, dedupResults, entityLabels, taskBuckets, agentMessages } from '../../db/schema';
import { eventBus } from '../../events/bus-adapter';
import { nanoid } from 'nanoid';
import {
  createPrompt, getPrompt, listPrompts,
  getPromptDescendants, getPromptJourney,
  listTaskTransitions,
} from '../../prompts/manager';
import type { PromptStatus, PromptReceivedVia, PromptListOptions } from '../../prompts/types';
import { classifyKeyword } from '@chiefaia/classifier';
import { check as dedupCheck } from '@chiefaia/dedup-engine';
import { runScaffolder } from '../../agents/scaffolder';
import { isRunMode, RUN_MODES, estimateRunCost, type RunMode } from '../../run-modes';

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
      run_mode?: string;
    };

    if (!body.body || typeof body.body !== 'string') {
      return c.json({ error: 'body is required' }, 400);
    }

    // RUN-MODES (migration 0038): validate `run_mode` at the API
    // boundary. Unknown values are 400'd rather than silently coerced
    // to 'full' so callers learn about typos immediately.
    if (body.run_mode !== undefined && !isRunMode(body.run_mode)) {
      return c.json({
        error: `run_mode must be one of ${RUN_MODES.join(', ')} (got ${JSON.stringify(body.run_mode)})`,
      }, 400);
    }

    const prompt = createPrompt(db, {
      body: body.body,
      receivedVia: (body.received_via ?? 'api') as PromptReceivedVia,
      sessionId: body.session_id,
      userId: body.user_id,
      tokensIn: body.tokens_in,
      metadata: body.metadata,
      runMode: body.run_mode as RunMode | undefined,
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

  // RUN-MODES (migration 0038): plan-only output preview for a prompt.
  // Returns the WorkGraph (story IDs + parent/child links) +
  // per-story architecturalInstructions[] + estimated tokens / cost,
  // computed from the run-modes/cost estimator. Only meaningful for
  // run_mode='plan-only' prompts; for others the same data is
  // available but the cost estimate excludes coding-agent tokens that
  // *will* be consumed downstream.
  app.get('/prompts/:id/plan-output', async (c) => {
    const { id } = c.req.param();
    const prompt = getPrompt(db, id);
    if (!prompt) return c.json({ error: 'not found' }, 404);

    const storyRows = db.select({
      id: stories.id,
      title: stories.title,
      parentId: stories.parentId,
      bucketId: stories.bucketId,
      runMode: stories.runMode,
      agentContributionsJson: stories.agentContributionsJson,
      acceptanceCriteriaJson: stories.acceptanceCriteriaJson,
    }).from(stories).where(eq(stories.rootPromptId, id)).all();

    const storyIds = storyRows.map((s) => s.id);
    const mode = (prompt.runMode ?? 'full') as RunMode;
    const cost = estimateRunCost(mode, storyIds);

    return c.json({
      promptId: id,
      runMode: mode,
      stories: storyRows.map((s) => {
        let architecturalInstructions: unknown[] = [];
        try {
          const parsed = JSON.parse(s.agentContributionsJson || '{}') as {
            architecturalInstructions?: unknown[];
          };
          architecturalInstructions = parsed.architecturalInstructions ?? [];
        } catch { /* ignore parse errors */ }
        return {
          id: s.id,
          title: s.title,
          parentId: s.parentId,
          bucketId: s.bucketId,
          architecturalInstructions,
        };
      }),
      cost,
    });
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

  // Get prompt with full pipeline visualization (DASH-203)
  // Returns the `PipelineData` shape the dashboard's /pipeline page expects:
  //   { promptId, promptBody, promptReceivedAt, promptStatus,
  //     requirements: [{ id, title, status, createdAt, stories: [
  //       { id, title, status, tasks: [
  //         { id, title, status, createdAt, completedAt, taskRuns: [...] }
  //       ]}
  //     ]}],
  //     totalDurationMs, totalTokensIn, totalTokensOut, totalFilesChanged,
  //     overallStatus }
  app.get('/prompts/:id/pipeline', async (c) => {
    const promptId = c.req.param('id');

    const prompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
    if (!prompt) return c.json({ error: 'Not found' }, 404);

    // Stages (used to derive overall duration)
    const stages = db.select().from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, promptId))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();

    // All requirements linked to this prompt
    const reqs = db.select().from(requirements)
      .where(eq(requirements.rootPromptId, promptId))
      .all();

    // All stories linked to this prompt (any kind: epic / story / sub_story / task)
    const allStoriesForPrompt = db.select().from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .all();

    // Build the tree in PipelineData shape
    const flatRunsAccumulator: Array<typeof taskRuns.$inferSelect> = [];

    const tree = reqs.map((req) => {
      const reqStories = allStoriesForPrompt; // every story for this prompt rolls up under its requirement(s)

      const storiesNode = reqStories.map((story) => {
        const storyTasks = db.select().from(dbTasks)
          .where(eq(dbTasks.parentEntityId, story.id))
          .all();

        const tasksNode = storyTasks.map((task) => {
          const runs = db.select().from(taskRuns)
            .where(eq(taskRuns.parentEntityId, task.id))
            .orderBy(asc(taskRuns.startedAt))
            .all();
          flatRunsAccumulator.push(...runs);

          return {
            id: task.id,
            title: task.title,
            status: task.status,
            createdAt: task.createdAt ?? null,
            completedAt: task.completedAt ?? null,
            taskRuns: runs.map((r, idx) => ({
              id: r.id,
              runIndex: idx + 1,
              durationMs: r.startedAt && r.endedAt
                ? new Date(r.endedAt).getTime() - new Date(r.startedAt).getTime()
                : null,
              tokensIn: r.inputTokens ?? null,
              tokensOut: r.outputTokens ?? null,
              filesChanged: r.filesChanged
                ? (() => { try { return (JSON.parse(r.filesChanged as string) as unknown[]).length; } catch { return null; } })()
                : null,
              status: r.status ?? undefined,
              startedAt: r.startedAt ?? null,
              finishedAt: r.endedAt ?? null,
            })),
            completenessChecks: [],
          };
        });

        return {
          id: story.id,
          title: story.title,
          status: story.status ?? 'pending',
          tasks: tasksNode,
        };
      });

      return {
        id: req.id,
        title: req.title,
        status: req.state ?? 'captured',
        createdAt: req.createdAt ?? null,
        stories: storiesNode,
      };
    });

    // Aggregate totals across all task_runs in the tree
    const totalTokensIn = flatRunsAccumulator.reduce((acc, r) => acc + (r.inputTokens ?? 0), 0);
    const totalTokensOut = flatRunsAccumulator.reduce((acc, r) => acc + (r.outputTokens ?? 0), 0);
    const totalFilesChanged = (() => {
      const all = new Set<string>();
      for (const r of flatRunsAccumulator) {
        if (!r.filesChanged) continue;
        try {
          const arr = JSON.parse(r.filesChanged as string) as unknown[];
          for (const f of arr) if (typeof f === 'string') all.add(f);
        } catch { /* ignore */ }
      }
      return all.size;
    })();
    const totalDurationMs = stages.length > 0
      ? Date.now() - stages[0].enteredAt
      : null;

    // Overall status: derived from prompt status; pipeline is done when prompt is.
    const overallStatus = prompt.status ?? 'pending';

    return c.json({
      promptId: prompt.id,
      promptBody: prompt.body,
      promptReceivedAt: prompt.receivedAt,
      promptStatus: prompt.status ?? 'pending',
      requirements: tree,
      totalDurationMs,
      totalTokensIn,
      totalTokensOut,
      totalFilesChanged,
      overallStatus,
    });
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

  // GET /prompts/:id/phase1 — Phase-1 dashboard payload (GATE-4-01).
  //
  // Returns everything the dashboard's `/prompts/[id]/journey` page needs to
  // render the full Phase-1 timeline live:
  //
  //   - prompt: id/body/correlationId/status/receivedAt
  //   - pipelineStages: every transition row (ingested → ready_for_pickup),
  //                     ordered by enteredAt, including epoch-ms timestamps
  //                     and durationMs back-fills
  //   - stories: the rows produced by PO + BA, with template validation
  //              status, bucket linkage and a parsed acceptance-criteria
  //              count for the timeline summary
  //   - buckets: every task_bucket row for this prompt (sequential per
  //              domain + the parallel pool), each with a stories[] list
  //              of story ids placed into it (so the dashboard's bucket
  //              viz / journey page knows which bucket landed which ticket)
  //   - agentMessages: BA cross-agent input requests + replies (filtered
  //                    by the per-story sub-correlation prefix), sorted by
  //                    createdAt — surfaces the BA collaboration thread
  //   - phase1Events: every Phase-1 event correlated to this prompt or to
  //                   a sub-correlation `${correlationId}::*`, ordered by
  //                   occurredAt; the WS-driven page uses these to drive
  //                   stage timestamps and the BA inspector
  //
  // The endpoint is read-only and has no side effects. The dashboard polls
  // it once on load and refetches when a Phase-1 WS event arrives — that
  // gives the live update without keeping a long-running query open.
  app.get('/prompts/:id/phase1', (c) => {
    const promptId = c.req.param('id');
    const prompt = db.select().from(prompts).where(eq(prompts.id, promptId)).get();
    if (!prompt) return c.json({ error: 'not found' }, 404);

    const pipelineStages = db
      .select()
      .from(promptPipelineStages)
      .where(eq(promptPipelineStages.promptId, promptId))
      .orderBy(asc(promptPipelineStages.enteredAt))
      .all();

    const storyRows = db
      .select()
      .from(stories)
      .where(eq(stories.rootPromptId, promptId))
      .orderBy(asc(stories.ordinal))
      .all();

    function safeAcCount(raw: string | null | undefined): number {
      if (!raw) return 0;
      try {
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed.length : 0;
      } catch { return 0; }
    }

    const storiesNode = storyRows.map((s) => ({
      id: s.id,
      title: s.title,
      kind: s.kind,
      status: s.status,
      bucketId: s.bucketId,
      templateVersion: s.templateVersion,
      templateValidationStatus: s.templateValidationStatus,
      acceptanceCriteriaCount: safeAcCount(s.acceptanceCriteriaJson),
      enrichedAt: s.enrichedAt,
      updatedAt: s.updatedAt,
    }));

    const bucketRows = db
      .select()
      .from(taskBuckets)
      .where(eq(taskBuckets.promptId, promptId))
      .orderBy(asc(taskBuckets.createdAt))
      .all();

    // Group story ids by bucket for quick rendering.
    const storiesByBucket = new Map<string, string[]>();
    for (const s of storyRows) {
      if (!s.bucketId) continue;
      const arr = storiesByBucket.get(s.bucketId) ?? [];
      arr.push(s.id);
      storiesByBucket.set(s.bucketId, arr);
    }

    const bucketsNode = bucketRows.map((b) => ({
      id: b.id,
      kind: b.kind,
      domainSlug: b.domainSlug,
      sequenceIndex: b.sequenceIndex,
      status: b.status,
      createdAt: b.createdAt,
      storyIds: storiesByBucket.get(b.id) ?? [],
    }));

    // BA collaboration messages — the BA agent uses sub-correlation
    // ids of shape `${promptCorrelationId}::${storyId}`. We capture rows
    // whose correlationId equals the prompt's correlation OR starts with
    // that prefix to surface every per-story exchange. SQLite has no
    // native LIKE on bound params, so we pull a wider set and filter in
    // memory — agent_messages is small per-prompt.
    const allMsgs = db
      .select()
      .from(agentMessages)
      .orderBy(asc(agentMessages.createdAt))
      .all();
    const messages = allMsgs.filter((m) =>
      m.correlationId === prompt.correlationId ||
      m.correlationId?.startsWith(`${prompt.correlationId}::`),
    );

    // Phase-1 event types (subset of the canonical taxonomy that drives
    // dashboard updates). We do NOT introduce new event types here —
    // these all come from existing emitters per Gate 3.
    const PHASE1_TYPES = new Set([
      'prompt.ingested',
      'prompt.received',
      'prompt.status_changed',
      'scaffolder.team.assembled',
      'po-agent.decomposition.complete',
      'ba-agent.input-requested',
      'ba-agent.input-received',
      'ba-agent.enrichment.complete',
      'task-scheduler.bucket-placed',
      'task-scheduler.scheduling.complete',
      'ticket.draft',
      'ticket.po-decomposed',
      'ticket.ba-enriching',
      'ticket.ba-complete',
      'ticket.ready-for-pickup',
      'pipeline.stage.advanced',
    ]);

    // Pull events under the prompt correlation OR any sub-correlation
    // (`::storyId`). Same filter as above — load-then-filter is fine for
    // per-prompt cardinality.
    const allEvents = db
      .select()
      .from(events)
      .orderBy(asc(events.occurredAt))
      .all();
    const phase1Events = allEvents
      .filter((e) =>
        PHASE1_TYPES.has(e.type) &&
        (e.correlationId === prompt.correlationId ||
         e.correlationId?.startsWith(`${prompt.correlationId}::`)),
      )
      .map((e) => {
        let payload: unknown = null;
        try { payload = JSON.parse(e.payloadJson); } catch { /* ignore */ }
        return {
          id: e.id,
          type: e.type,
          actor: e.actor,
          occurredAt: e.occurredAt,
          correlationId: e.correlationId,
          entityType: e.entityType,
          entityId: e.entityId,
          payload,
          severity: e.severity,
        };
      });

    return c.json({
      prompt: {
        id: prompt.id,
        body: prompt.body,
        receivedAt: prompt.receivedAt,
        correlationId: prompt.correlationId,
        status: prompt.status,
      },
      pipelineStages: pipelineStages.map((s) => ({
        id: s.id,
        stage: s.stage,
        entityKind: s.entityKind,
        entityId: s.entityId,
        enteredAt: s.enteredAt,
        durationMs: s.durationMs,
        metadata: s.metadata,
      })),
      stories: storiesNode,
      buckets: bucketsNode,
      agentMessages: messages.map((m) => ({
        id: m.id,
        fromAgent: m.fromAgent,
        toAgent: m.toAgent,
        messageType: m.messageType,
        correlationId: m.correlationId,
        status: m.status,
        createdAt: m.createdAt,
        processedAt: m.processedAt,
        expectedReplyBy: m.expectedReplyBy,
        repliedAt: m.repliedAt,
        parentMessageId: m.parentMessageId,
        payload: (() => { try { return JSON.parse(m.payload); } catch { return m.payload; } })(),
      })),
      phase1Events,
    });
  });
}
