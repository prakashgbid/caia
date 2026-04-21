import type { Hono } from 'hono';
import { eq, desc } from 'drizzle-orm';
import type { Db } from '../../db/connection';
import { events } from '../../db/schema';
import {
  createPrompt, getPrompt, listPrompts,
  getPromptDescendants, getPromptJourney,
  listTaskTransitions,
} from '../../prompts/manager';
import type { PromptStatus, PromptReceivedVia, PromptListOptions } from '../../prompts/types';

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
}
