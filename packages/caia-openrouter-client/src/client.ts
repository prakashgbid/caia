/**
 * The unified OpenRouter client for CAIA.
 *
 * Single choke point per [[openrouter-only]]. Every AI call in CAIA
 * (customer flows + orchestrator) MUST route through callOpenRouter().
 *
 * Contract:
 *   - Retries with fallback ladder on 429/5xx (max 3 models tried).
 *   - Free-tier by default (safe for dev + pre-payment flows).
 *   - Tenant-aware key resolution (BYOK-first via KeyResolver).
 *   - JSON-mode with response_format + prose-embedded extraction fallback.
 *   - Cost tracked in USD (0 for free-tier).
 *   - Latency + attempts + model attempted list returned.
 *   - Never throws on API errors — returns ORCallFailure with retryable flag.
 *   - Throws only for programmer errors (missing user prompt, etc.).
 */

import {
  DEFAULT_FREE_TIER_LADDER,
  FREE_TIER_TASK_MAP,
  PAID_TIER_TASK_MAP,
  getFreeTierLadder,
} from './models.js';
import { extractJson } from './json-extract.js';
import { envKeyResolver } from './keys.js';
import type { ORCallOptions, ORCallResult, KeyResolver } from './types.js';

export interface ClientConfig {
  baseUrl?: string;
  keyResolver?: KeyResolver;
  /** Referer + X-Title for OpenRouter attribution. */
  attribution?: { referer: string; title: string };
}

const DEFAULT_CONFIG: Required<ClientConfig> = {
  baseUrl: 'https://openrouter.ai/api/v1',
  keyResolver: envKeyResolver,
  attribution: { referer: 'https://chiefaia.com', title: 'CAIA' },
};

interface OpenRouterChoice {
  message?: { content?: string };
  finish_reason?: string;
}
interface OpenRouterResponse {
  id?: string;
  model?: string;
  choices?: OpenRouterChoice[];
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
    cost?: number;
  };
  error?: { message?: string; code?: number };
}

/**
 * Pick the ordered list of models to try, given the request.
 */
function planModelLadder(opts: ORCallOptions): string[] {
  const selection = opts.model ?? 'free';

  // Explicit model id
  if (typeof selection === 'string' && selection !== 'free' && selection !== 'auto') {
    return [selection];
  }

  if (selection === 'free') {
    const ladder = getFreeTierLadder();
    if (opts.taskType && FREE_TIER_TASK_MAP[opts.taskType]) {
      const preferred = FREE_TIER_TASK_MAP[opts.taskType]!;
      const rest = ladder.filter((m) => m !== preferred);
      return [preferred, ...rest].slice(0, 5);
    }
    return [...ladder].slice(0, 5);
  }

  // 'auto' — paid tier
  if (opts.taskType && PAID_TIER_TASK_MAP[opts.taskType]) {
    return [PAID_TIER_TASK_MAP[opts.taskType]!];
  }
  return [PAID_TIER_TASK_MAP.reasoning!];
}

const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

/**
 * Make one HTTP call to OpenRouter with a specific model.
 * Returns the normalized response object or throws on network error.
 */
async function callOnce(
  cfg: Required<ClientConfig>,
  apiKey: string,
  model: string,
  opts: ORCallOptions,
  perAttemptTimeoutMs: number,
): Promise<{ status: number; body: OpenRouterResponse; latencyMs: number }> {
  const messages: Array<{ role: 'system' | 'user'; content: string }> = [];
  if (opts.systemPrompt) messages.push({ role: 'system', content: opts.systemPrompt });
  messages.push({ role: 'user', content: opts.userPrompt });

  const payload: Record<string, unknown> = {
    model,
    messages,
    max_tokens: opts.maxTokens ?? 1024,
  };
  if (opts.responseFormat === 'json') {
    payload.response_format = { type: 'json_object' };
  }

  const headers: Record<string, string> = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };
  if (opts.attributeTraffic !== false) {
    headers['HTTP-Referer'] = cfg.attribution.referer;
    headers['X-Title'] = cfg.attribution.title;
  }

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), perAttemptTimeoutMs);
  const started = Date.now();
  try {
    const res = await fetch(`${cfg.baseUrl}/chat/completions`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ac.signal,
    });
    const body = (await res.json().catch(() => ({}))) as OpenRouterResponse;
    return { status: res.status, body, latencyMs: Date.now() - started };
  } finally {
    clearTimeout(t);
  }
}

/**
 * Main entry point. Every AI call in CAIA goes through this.
 */
export async function callOpenRouter(
  opts: ORCallOptions,
  config: ClientConfig = {},
): Promise<ORCallResult> {
  if (!opts.userPrompt || opts.userPrompt.trim().length === 0) {
    throw new Error('callOpenRouter: userPrompt is required and non-empty');
  }
  if (!opts.purpose || opts.purpose.trim().length === 0) {
    throw new Error('callOpenRouter: purpose is required (audit label)');
  }

  const cfg: Required<ClientConfig> = {
    baseUrl: config.baseUrl ?? DEFAULT_CONFIG.baseUrl,
    keyResolver: config.keyResolver ?? DEFAULT_CONFIG.keyResolver,
    attribution: config.attribution ?? DEFAULT_CONFIG.attribution,
  };

  const overallStart = Date.now();
  const models = planModelLadder(opts);
  const overallTimeout = opts.timeoutMs ?? 60_000;
  const perAttemptTimeout = Math.max(5_000, Math.floor(overallTimeout / Math.max(1, models.length)));
  const attempted: string[] = [];

  let apiKey: string;
  try {
    apiKey = await cfg.keyResolver(opts.tenantId);
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'key resolution failed',
      retryable: false,
      modelsAttempted: [],
      latencyMs: Date.now() - overallStart,
      attempts: 0,
    };
  }

  let lastError = 'no attempt made';
  let lastRetryable = true;
  let attempts = 0;

  for (const model of models) {
    attempts += 1;
    attempted.push(model);
    if (Date.now() - overallStart > overallTimeout) {
      return {
        ok: false,
        error: `overall timeout ${overallTimeout}ms exceeded before trying ${model}`,
        retryable: true,
        modelsAttempted: attempted,
        latencyMs: Date.now() - overallStart,
        attempts,
      };
    }
    try {
      const { status, body } = await callOnce(cfg, apiKey, model, opts, perAttemptTimeout);
      if (status >= 200 && status < 300 && body.choices && body.choices[0]?.message?.content) {
        const text = body.choices[0].message.content;
        const usage = body.usage ?? {};
        const result: ORCallResult = {
          ok: true,
          model: body.model ?? model,
          text,
          costUsd: usage.cost ?? 0,
          latencyMs: Date.now() - overallStart,
          responseId: body.id ?? '',
          usage: {
            promptTokens: usage.prompt_tokens ?? 0,
            completionTokens: usage.completion_tokens ?? 0,
            totalTokens: usage.total_tokens ?? 0,
          },
          attempts,
        };
        if (opts.responseFormat === 'json') {
          const parsed = extractJson(text);
          if (parsed.ok) {
            (result as { json?: unknown }).json = parsed.value;
          } else {
            return {
              ok: false,
              error: `json parse failed on model=${model}: ${parsed.reason}`,
              retryable: false,
              modelsAttempted: attempted,
              latencyMs: Date.now() - overallStart,
              attempts,
            };
          }
        }
        return result;
      }
      // Non-2xx or malformed
      lastError = body.error?.message ?? `HTTP ${status} without choices`;
      lastRetryable = RETRYABLE_STATUSES.has(status);
      if (!lastRetryable) break;
    } catch (e) {
      lastError = e instanceof Error ? e.message : String(e);
      lastRetryable = true;
    }
  }

  return {
    ok: false,
    error: lastError,
    retryable: lastRetryable,
    modelsAttempted: attempted,
    latencyMs: Date.now() - overallStart,
    attempts,
  };
}
