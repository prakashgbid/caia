/**
 * @caia/openrouter-client — the unified OpenRouter gateway for CAIA.
 *
 * Single choke point per [[openrouter-only]] memory rule. Every AI/LLM
 * call in CAIA (product flows AND orchestrator) routes through
 * `callOpenRouter()`.
 *
 * Basic usage:
 *
 *   import { callOpenRouter } from '@caia/openrouter-client';
 *
 *   const res = await callOpenRouter({
 *     purpose: 'interview.question',
 *     userPrompt: 'Ask the founder one follow-up question about ...',
 *     model: 'free',            // default
 *     taskType: 'reasoning',    // optional; picks a preferred free model
 *     responseFormat: 'json',   // optional
 *   });
 *
 *   if (res.ok) {
 *     console.log(res.text, 'cost:', res.costUsd, 'model:', res.model);
 *   } else if (res.retryable) {
 *     // 429/5xx — the client already tried the ladder, escalate or wait
 *   } else {
 *     // fatal — auth, invalid model, JSON parse failure
 *   }
 *
 * Tenant + BYOK usage (production wire-up):
 *
 *   import { callOpenRouter, makeTenantAwareResolver } from '@caia/openrouter-client';
 *
 *   const resolver = makeTenantAwareResolver(async (tid) => {
 *     // your Vault-backed lookup; return the BYOK key or null
 *     return await vaultKvGet(`secret/caia/tenants/${tid}/openrouter`, 'api_key');
 *   });
 *
 *   const res = await callOpenRouter(
 *     { purpose: 'research.market', userPrompt: '...', tenantId: 'tenant-42' },
 *     { keyResolver: resolver },
 *   );
 */

export { callOpenRouter } from './client.js';
export type { ClientConfig } from './client.js';
export {
  DEFAULT_FREE_TIER_LADDER,
  FREE_TIER_TASK_MAP,
  PAID_TIER_TASK_MAP,
  PAID_GUARANTEE_MODEL,
  PAID_LONG_CONTEXT_MODEL,
  getFreeTierLadder,
  refreshFreeTierLadder,
} from './models.js';
export { envKeyResolver, makeTenantAwareResolver, MissingKeyError } from './keys.js';
export { extractJson } from './json-extract.js';
export type {
  ORCallOptions,
  ORCallResult,
  ORCallSuccess,
  ORCallFailure,
  ORModelSelection,
  ORResponseFormat,
  ORPurpose,
  KeyResolver,
} from './types.js';
