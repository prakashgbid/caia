// Minimal LLM-routing endpoint that proves @chiefaia/local-llm-router
// can dispatch traffic to local Ollama models from inside CAIA.
//
// This is a stub call site. Full agent integration (story-decomposer,
// classifier, etc.) lifts into CAIA in follow-up PRs. For now we just
// expose the routing layer so any caller can ask the router to handle
// a known taskType — proving end-to-end that simple work no longer
// hits the Claude API.

import type { Hono } from 'hono';
import { route, getRoute, ROUTING_RULES, COST_ANALYSIS } from '@chiefaia/local-llm-router';

interface LlmRouteBody {
  taskType?: string;
  prompt?: string;
  forceLocal?: boolean;
  forceClaude?: boolean;
}

// @no-events — pure routing decision endpoint, downstream handlers emit events
export function registerLlmRoutes(app: Hono): void {
  app.get('/llm/rules', (c) => {
    return c.json({
      rules: ROUTING_RULES,
      costAnalysis: COST_ANALYSIS,
    });
  });

  app.get('/llm/rules/:taskType', (c) => {
    const { taskType } = c.req.param();
    return c.json(getRoute(taskType));
  });

  app.post('/llm/route', async (c) => {
    let body: LlmRouteBody;
    try {
      body = await c.req.json<LlmRouteBody>();
    } catch {
      return c.json({ error: 'invalid json body' }, 400);
    }
    const taskType = body.taskType;
    const prompt = body.prompt;
    if (!taskType || !prompt) {
      return c.json({ error: 'taskType and prompt are required' }, 400);
    }

    try {
      const result = await route(taskType, prompt, {
        ...(body.forceLocal !== undefined ? { forceLocal: body.forceLocal } : {}),
        ...(body.forceClaude !== undefined ? { forceClaude: body.forceClaude } : {}),
      });
      return c.json(result);
    } catch (err) {
      return c.json({ error: String(err) }, 502);
    }
  });
}
