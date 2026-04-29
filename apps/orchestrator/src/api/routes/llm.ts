// LLM-routing endpoint and live metrics surface (LAI-006).
//
// Flow per request:
//   1. POST /llm/route  -> @chiefaia/local-llm-router decides local vs Claude
//   2. After dispatch we record the call into the in-memory llmMetrics
//      tracker (also exported by the router package) so the dashboard can
//      show live local-share / dollar savings.
//   3. GET /llm/metrics returns the aggregated snapshot.

import type { Hono } from 'hono';
import {
  route,
  getRoute,
  ROUTING_RULES,
  COST_ANALYSIS,
  llmMetrics,
  perCallCostFromRuleString,
  type LlmMetricsProvider,
} from '@chiefaia/local-llm-router';
import {
  llmCallsTotal,
  llmCallDurationMs,
  llmTokensTotal,
  llmEstimatedSavedUsd,
} from '../../metrics/prometheus';

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

  app.get('/llm/metrics', (c) => {
    return c.json(llmMetrics.snapshot());
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

    const start = Date.now();
    try {
      const result = await route(taskType, prompt, {
        ...(body.forceLocal !== undefined ? { forceLocal: body.forceLocal } : {}),
        ...(body.forceClaude !== undefined ? { forceClaude: body.forceClaude } : {}),
      });

      // ── record metrics ──────────────────────────────────────────────────
      const rule = getRoute(taskType);
      const baselinePerCall = perCallCostFromRuleString(
        rule.estimatedCostClaude,
      );
      const actualPerCall =
        result.provider === 'local' ? 0 : baselinePerCall;
      const provider: LlmMetricsProvider = result.provider;

      llmMetrics.record({
        taskType,
        provider,
        model: result.model,
        durationMs: result.durationMs,
        ...(result.usage?.promptTokens !== undefined
          ? { promptTokens: result.usage.promptTokens }
          : {}),
        ...(result.usage?.completionTokens !== undefined
          ? { completionTokens: result.usage.completionTokens }
          : {}),
        estimatedCostUsd: actualPerCall,
        baselineCostUsd: baselinePerCall,
        timestamp: Date.now(),
      });

      // ── mirror to Prometheus for time-series ────────────────────────────
      llmCallsTotal
        .labels(provider, result.model, taskType, 'ok')
        .inc();
      llmCallDurationMs
        .labels(provider, result.model, taskType)
        .observe(result.durationMs);
      if (result.usage?.promptTokens !== undefined) {
        llmTokensTotal
          .labels(provider, result.model, 'input')
          .inc(result.usage.promptTokens);
      }
      if (result.usage?.completionTokens !== undefined) {
        llmTokensTotal
          .labels(provider, result.model, 'output')
          .inc(result.usage.completionTokens);
      }
      llmEstimatedSavedUsd
        .labels(provider)
        .inc(Math.max(0, baselinePerCall - actualPerCall));

      return c.json(result);
    } catch (err) {
      // Best-effort metrics on failure — we still want the call counted
      // even if it errored, so failure rates are visible on the dashboard.
      llmCallsTotal
        .labels('claude', 'unknown', taskType, 'error')
        .inc();
      llmCallDurationMs
        .labels('claude', 'unknown', taskType)
        .observe(Date.now() - start);
      return c.json({ error: String(err) }, 502);
    }
  });
}
