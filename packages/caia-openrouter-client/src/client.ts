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
  PAID_GUARANTEE_MODEL,
  PAID_LONG_CONTEXT_MODEL,
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
 * Pick the ordered list of models to send to OpenRouter's native `models`
 * fallback array. Capped at 3 by OpenRouter (tested 2026-08-26 — returns
 * 400 "models array must have 3 items or fewer" beyond that).
 *
 * Composition strategy:
 *   1. Sticky model (if caller provided one from a prior turn) OR the
 *      caller's `model` selection (pinned id / 'free' first-of-ladder /
 *      'auto' task-tier choice)
 *   2. A free-tier alternative (different upstream provider so a single
 *      provider's shared-pool 429 doesn't fail both slots 1 and 2)
 *   3. Paid guarantee model — mistral-nemo by default, or a long-context
 *      variant if taskType='long_context'. Costs ~\$0.00006/turn but
 *      makes the call effectively never fail from provider throttling.
 *
 * The paid guarantee slot can be disabled via opts.paidFallback=false.
 */
function planModelLadder(opts: ORCallOptions): string[] {
  const selection = opts.model ?? 'free';
  const ladder = getFreeTierLadder();
  const sticky = opts.stickyModel && opts.stickyModel.trim() !== '' ? opts.stickyModel.trim() : null;

  // Slot 1: sticky wins; else user's selection resolves to a concrete model
  let slot1: string;
  if (sticky) {
    slot1 = sticky;
  } else if (typeof selection === 'string' && selection !== 'free' && selection !== 'auto') {
    slot1 = selection;
  } else if (selection === 'free') {
    slot1 =
      opts.taskType && FREE_TIER_TASK_MAP[opts.taskType]
        ? FREE_TIER_TASK_MAP[opts.taskType]!
        : ladder[0] ?? 'minimax/minimax-m3:free';
  } else {
    // 'auto' — paid tier
    slot1 =
      opts.taskType && PAID_TIER_TASK_MAP[opts.taskType]
        ? PAID_TIER_TASK_MAP[opts.taskType]!
        : PAID_TIER_TASK_MAP.reasoning!;
  }

  // Slot 2: a different free-tier model from a different upstream provider
  const slot2 = ladder.find((m) => m !== slot1) ?? null;

  // Slot 3: paid guarantee (unless disabled)
  const wantPaid = opts.paidFallback !== false;
  const slot3 = wantPaid
    ? (opts.taskType === 'long_context' ? PAID_LONG_CONTEXT_MODEL : PAID_GUARANTEE_MODEL)
    : null;

  const models: string[] = [slot1];
  if (slot2 && slot2 !== slot1) models.push(slot2);
  if (slot3 && slot3 !== slot1 && slot3 !== slot2) models.push(slot3);
  // OpenRouter caps the `models` array at 3.
  return models.slice(0, 3);
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
  opts: ORCallOptions & { __modelsArray?: string[] },
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
  // OpenRouter native fallback — if the caller supplied a models list,
  // pass it so OpenRouter tries them all in one round-trip (cap 3).
  const modelsList = (opts as { __modelsArray?: string[] }).__modelsArray;
  if (modelsList && Array.isArray(modelsList) && modelsList.length > 1) {
    payload.models = modelsList.slice(0, 3);
  }
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

  // Single call to OpenRouter with the `models` array. OpenRouter tries
  // them in order server-side and returns whichever succeeds — one round
  // trip, no client-side loop. If ALL 3 fail (extremely rare — would
  // require the paid guarantee to be down too), we return the aggregate
  // error.
  attempts += 1;
  attempted.push(...models);
  const primaryModel = models[0] ?? 'minimax/minimax-m3:free';
  // Stash the fallback list so callOnce can add it to the payload.
  const optsWithModels = Object.assign({}, opts, { __modelsArray: models });
  try {
    const { status, body } = await callOnce(cfg, apiKey, primaryModel, optsWithModels, overallTimeout);
    if (status >= 200 && status < 300 && body.choices && body.choices[0]?.message?.content) {
      const text = body.choices[0].message.content;
      const usage = body.usage ?? {};
      const result: ORCallResult = {
        ok: true,
        model: body.model ?? primaryModel,
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
            error: `json parse failed on model=${result.model}: ${parsed.reason}`,
            retryable: false,
            modelsAttempted: attempted,
            latencyMs: Date.now() - overallStart,
            attempts,
          };
        }
      }
      return result;
    }
    lastError = body.error?.message ?? `HTTP ${status} without choices (models tried: ${models.join(', ')})`;
    const inner = body.error?.code;
    lastRetryable =
      RETRYABLE_STATUSES.has(status) ||
      (typeof inner === 'number' && RETRYABLE_STATUSES.has(inner)) ||
      (typeof lastError === 'string' && /overload|rate.?limit|temporarily|timeout|upstream/i.test(lastError));
  } catch (e) {
    lastError = e instanceof Error ? e.message : String(e);
    lastRetryable = true;
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
