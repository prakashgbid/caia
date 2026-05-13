// HTTP daemon for @chiefaia/local-llm-router (L4 of the Local-LLM-First build plan).
//
// Endpoints:
//   GET  /healthz                  → { ok, ollama, models }
//   GET  /metrics                  → Prometheus exposition (LLM call totals, savings)
//   POST /v1/intent                → classify a task spec into Intent JSON (v1)
//   POST /v1/intent/v2             → classifier v2 — cascade-aware, taxonomy from YAML
//   POST /v1/route                 → return route decision without executing
//   POST /v1/chat/completions      → OpenAI-compatible chat (single-turn)
//   POST /v1/embeddings            → OpenAI-compatible embeddings
//   POST /v1/optimize              → 3-stage prompt optimizer (LAI phase 8)
//
// Listens on port 7411 by default (env ROUTER_PORT to override).
// Binds to 0.0.0.0 so Tailscale-private peers can reach it; the Tailscale
// ACL is the auth surface (no in-process auth).

import { Hono } from 'hono';
import type { Context } from 'hono';
import { optimize } from '@chiefaia/prompt-optimizer';
import { route as routerRoute } from './router.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { classify, type IntentResult as _IntentResultRef } from './classifier.js';
import { classifyV2 } from './classifier-v2.js';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { OllamaAdapter as _OllamaAdapterRef2 } from './ollama-adapter.js';
import { llmMetrics } from './llm-metrics.js';
import { ROUTING_RULES } from './routing-config.js';

const ROUTER_VERSION = '0.3.0';
const DEFAULT_PORT = 7411;

export interface ServerOptions {
  ollamaBaseUrl?: string;
  classifierModel?: string;
}

export function buildApp(opts: ServerOptions = {}): Hono {
  const app = new Hono();
  const ollamaBaseUrl = opts.ollamaBaseUrl ?? process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';
  const classifierModel = opts.classifierModel ?? process.env['ROUTER_CLASSIFIER_MODEL'] ?? 'qwen2.5-coder:7b';

  // ─── /healthz ─────────────────────────────────────────────────────────
  app.get('/healthz', async (c: Context) => {
    let ollamaOk = false;
    let models: string[] = [];
    try {
      const r = await fetch(`${ollamaBaseUrl}/api/tags`, { signal: AbortSignal.timeout(2_000) });
      if (r.ok) {
        const body = (await r.json()) as { models?: Array<{ name: string }> };
        models = (body.models ?? []).map(m => m.name);
        ollamaOk = true;
      }
    } catch { /* ollamaOk stays false */ }
    return c.json({
      ok: true,
      router_version: ROUTER_VERSION,
      ollama: { base_url: ollamaBaseUrl, ok: ollamaOk, models_count: models.length },
      models,
      classifier_model: classifierModel,
      uptime_seconds: Math.floor(process.uptime()),
    });
  });

  // ─── /metrics (Prometheus exposition) ────────────────────────────────
  app.get('/metrics', (c: Context) => {
    const snap = llmMetrics.snapshot();
    const lines: string[] = [];
    lines.push('# HELP llm_router_calls_total Total LLM calls dispatched, by provider+model.');
    lines.push('# TYPE llm_router_calls_total counter');
    lines.push(`llm_router_calls_total{provider="local"} ${snap.localCalls}`);
    lines.push(`llm_router_calls_total{provider="claude"} ${snap.claudeCalls}`);
    lines.push(`llm_router_calls_total{provider="cache"} ${snap.cacheHits}`);
    lines.push('# HELP llm_router_estimated_cost_usd Estimated cost for routed calls (USD).');
    lines.push('# TYPE llm_router_estimated_cost_usd counter');
    lines.push(`llm_router_estimated_cost_usd ${snap.estimatedCostUsd}`);
    lines.push('# HELP llm_router_baseline_cost_usd Baseline (all-Claude) cost for the same calls (USD).');
    lines.push('# TYPE llm_router_baseline_cost_usd counter');
    lines.push(`llm_router_baseline_cost_usd ${snap.baselineCostUsd}`);
    lines.push(`# HELP llm_router_uptime_seconds Process uptime in seconds.`);
    lines.push(`# TYPE llm_router_uptime_seconds gauge`);
    lines.push(`llm_router_uptime_seconds ${Math.floor(process.uptime())}`);
    return c.text(lines.join('\n') + '\n', 200, { 'Content-Type': 'text/plain; version=0.0.4' });
  });

  // ─── /v1/intent ──────────────────────────────────────────────────────
  app.post('/v1/intent', async (c: Context) => {
    let body: { task_spec?: string; model?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const taskSpec = (body.task_spec ?? '').trim();
    if (taskSpec === '') return c.json({ error: 'task_spec-required' }, 400);
    const startMs = Date.now();
    const result = await classify(taskSpec, { model: body.model ?? classifierModel, ollamaBaseUrl });
    const latency_ms = Date.now() - startMs;
    return c.json({ ...result, latency_ms, classifier_model: body.model ?? classifierModel });
  });

  // ─── /v1/intent/v2 (classifier v2 — cascade-aware) ───────────────────
  // Same shape as /v1/intent but uses the externalized taxonomy in
  // config/routing-rules.yaml and returns cascade hints (next_tier,
  // needs_cascade). v1 endpoint above is unchanged.
  app.post('/v1/intent/v2', async (c: Context) => {
    let body: { task_spec?: string; model?: string; skip_keyword_prepass?: boolean };
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const taskSpec = (body.task_spec ?? '').trim();
    if (taskSpec === '') return c.json({ error: 'task_spec-required' }, 400);
    const startMs = Date.now();
    let result;
    try {
      result = await classifyV2(taskSpec, {
        model: body.model ?? classifierModel,
        ollamaBaseUrl,
        skipKeywordPrepass: body.skip_keyword_prepass === true,
      });
    } catch (e) {
      return c.json({ error: 'classifier-v2-failed', message: (e as Error).message }, 500);
    }
    const latency_ms = Date.now() - startMs;
    return c.json({ ...result, latency_ms, classifier_model: body.model ?? classifierModel });
  });

  // ─── /v1/route ──────────────────────────────────────────────────────
  // Returns the route decision (provider+model+tier) for a (taskType, prompt)
  // without executing anything. Useful for diagnostics + testing.
  app.post('/v1/route', async (c: Context) => {
    let body: { task_type?: string; prompt?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const taskType = body.task_type ?? '';
    const prompt = body.prompt ?? '';
    if (taskType === '' || prompt === '') return c.json({ error: 'task_type-and-prompt-required' }, 400);
    const rule = ROUTING_RULES.find(r => r.taskType === taskType);
    if (rule === undefined) {
      // No rule → ask the classifier
      const intent = await classify(prompt, { model: classifierModel, ollamaBaseUrl });
      return c.json({
        task_type: taskType, has_routing_rule: false,
        recommended_tier: intent.recommended_tier,
        intent: intent.intent, confidence: intent.confidence,
        reasoning: intent.reasoning,
      });
    }
    return c.json({
      task_type: taskType, has_routing_rule: true,
      use_local: rule.useLocal,
      local_model: rule.localModel,
      claude_model: rule.claudeModel,
      max_tokens: rule.maxTokens,
      estimated_cost_local: rule.estimatedCostLocal,
      estimated_cost_claude: rule.estimatedCostClaude,
    });
  });

  // ─── /v1/chat/completions (OpenAI-compatible single-turn) ────────────
  app.post('/v1/chat/completions', async (c: Context) => {
    let body: {
      model?: string;
      messages?: Array<{ role: string; content: string }>;
      max_tokens?: number;
      temperature?: number;
      caia_task_type?: string;  // CAIA extension — picks routing rule
    };
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const messages = body.messages ?? [];
    if (messages.length === 0) return c.json({ error: 'messages-required' }, 400);

    const userMsg = messages.filter(m => m.role === 'user').map(m => m.content).join('\n\n');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const _systemMsg = messages.find(m => m.role === 'system')?.content;

    // Default to "summarize" task type if caller didn't specify
    const taskType = body.caia_task_type ?? 'route-default';

    try {
      // Note: existing route() takes positional (taskType, prompt, options).
      // systemPrompt + max_tokens + temperature are not part of the current
      // router signature; the routing-config's per-task max_tokens applies.
      // Future enhancement: extend router to accept per-call overrides.
      const llmRes = await routerRoute(taskType, userMsg);
      // Shape as OpenAI chat-completions
      return c.json({
        id: `caia-router-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: llmRes.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: llmRes.response },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: llmRes.usage?.promptTokens ?? 0,
          completion_tokens: llmRes.usage?.completionTokens ?? 0,
          total_tokens: llmRes.usage?.totalTokens ?? 0,
        },
        caia: { provider: llmRes.provider, duration_ms: llmRes.durationMs },
      });
    } catch (e) {
      return c.json({ error: 'route-failed', message: (e as Error).message }, 502);
    }
  });

  // ─── /v1/optimize (LAI phase 8 — 3-stage prompt optimizer) ──────────
  // Accepts an OptimizerInput-shaped body (userQuestion required; systemPrompt,
  // toolOutputs, recentReasoning, budget optional) and returns the
  // OptimizerResult: { optimizedPrompt, metrics, protectedSpanCount }.
  //
  // Calls @chiefaia/prompt-optimizer in-process. Stage 2/3 re-enter this same
  // daemon via /v1/chat/completions, so we default the optimizer's
  // routerBaseUrl to ourselves (the in-binding loopback) unless caller overrides.
  app.post('/v1/optimize', async (c: Context) => {
    let body: {
      userQuestion?: string;
      systemPrompt?: string;
      toolOutputs?: Array<{ id: string; content: string; source?: 'file' | 'json' | 'shell' | 'opaque' }>;
      recentReasoning?: string[];
      budget?: {
        stage2Ratio?: number;
        stage3Ratio?: number;
        skipStagesUnderTokens?: number;
        routerBaseUrl?: string;
        model?: string;
      };
    };
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const userQuestion = (body.userQuestion ?? '').trim();
    if (userQuestion === '') return c.json({ error: 'userQuestion-required' }, 400);

    const startMs = Date.now();
    try {
      const result = await optimize({
        userQuestion,
        ...(body.systemPrompt !== undefined ? { systemPrompt: body.systemPrompt } : {}),
        ...(body.toolOutputs !== undefined ? { toolOutputs: body.toolOutputs } : {}),
        ...(body.recentReasoning !== undefined ? { recentReasoning: body.recentReasoning } : {}),
        budget: {
          // Default to loopback so Stage 2/3 hit ourselves; caller can override.
          routerBaseUrl: body.budget?.routerBaseUrl ?? 'http://127.0.0.1:7411',
          ...(body.budget?.model !== undefined ? { model: body.budget.model } : {}),
          ...(body.budget?.stage2Ratio !== undefined ? { stage2Ratio: body.budget.stage2Ratio } : {}),
          ...(body.budget?.stage3Ratio !== undefined ? { stage3Ratio: body.budget.stage3Ratio } : {}),
          ...(body.budget?.skipStagesUnderTokens !== undefined ? { skipStagesUnderTokens: body.budget.skipStagesUnderTokens } : {}),
        },
      });
      return c.json({
        optimized_prompt: result.optimizedPrompt,
        protected_span_count: result.protectedSpanCount,
        metrics: result.metrics,
        wall_ms: Date.now() - startMs,
      });
    } catch (e) {
      return c.json({ error: 'optimize-failed', message: (e as Error).message }, 500);
    }
  });

  // ─── /v1/embeddings (OpenAI-compatible) ──────────────────────────────
  app.post('/v1/embeddings', async (c: Context) => {
    let body: { input?: string | string[]; model?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: 'invalid-json' }, 400); }
    const input = body.input;
    if (input === undefined) return c.json({ error: 'input-required' }, 400);
    const texts = Array.isArray(input) ? input : [input];
    const model = body.model ?? 'nomic-embed-text';
    const data: Array<{ object: string; embedding: number[]; index: number }> = [];
    for (let i = 0; i < texts.length; i++) {
      const r = await fetch(`${ollamaBaseUrl}/api/embeddings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, prompt: texts[i] }),
      });
      if (!r.ok) return c.json({ error: 'embeddings-failed', status: r.status }, 502);
      const j = (await r.json()) as { embedding?: number[] };
      data.push({ object: 'embedding', embedding: j.embedding ?? [], index: i });
    }
    return c.json({
      object: 'list',
      data,
      model,
      usage: { prompt_tokens: 0, total_tokens: 0 },
    });
  });

  return app;
}

export const DEFAULT_ROUTER_PORT = DEFAULT_PORT;
