/**
 * callWithRouting — one-liner AI call that picks the right model per purpose.
 *
 * Reads MODEL_LADDER, tries primary first, falls back through the ladder
 * on retryable failures. Every AI call site in the wizard should use this
 * instead of raw callOpenRouter so the model choice stays in one place.
 */

import { callOpenRouter, type ORCallOptions, type ORCallResult } from '@caia/openrouter-client';
import { resolveLadder } from './model-routing';

export interface RoutedCallOverrides {
  systemPrompt?: string;
  userPrompt: string;
  responseFormat?: 'text' | 'json';
  /** Override the ladder's maxTokens (rarely needed). */
  maxTokens?: number;
  /** Override the ladder's timeoutMs (rarely needed). */
  timeoutMs?: number;
  /** Session stickiness — pass the model id from turn 1 for tone consistency on turn N. */
  stickyModel?: string;
  /** Tenant id for BYOK key resolution + audit. */
  tenantId?: string | null;
}

export async function callWithRouting(purpose: string, opts: RoutedCallOverrides): Promise<ORCallResult> {
  const ladder = resolveLadder(purpose);
  const models = [ladder.primary, ...ladder.fallbacks];

  let lastErr: ORCallResult | null = null;
  for (const model of models) {
    const call: ORCallOptions = {
      // Purpose is a free-string on the client's side — cast to satisfy the enum
      purpose: purpose as ORCallOptions['purpose'],
      model: opts.stickyModel || model,
      systemPrompt: opts.systemPrompt,
      userPrompt: opts.userPrompt,
      maxTokens: opts.maxTokens ?? ladder.maxTokens,
      timeoutMs: opts.timeoutMs ?? ladder.timeoutMs,
      responseFormat: opts.responseFormat ?? 'text',
      tenantId: opts.tenantId ?? null,
      paidFallback: true,
    };
    const r = await callOpenRouter(call);
    if (r.ok) return r;
    lastErr = r;
    if (!r.retryable) break; // e.g. auth error or bad prompt — no point trying other models
    // eslint-disable-next-line no-console
    console.warn(`[callWithRouting] purpose=${purpose} model=${model} failed: ${r.error}. Trying next.`);
  }
  return lastErr as ORCallResult;
}
