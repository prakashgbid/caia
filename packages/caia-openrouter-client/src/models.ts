/**
 * Free-tier + paid-tier model ladders for OpenRouter.
 *
 * The free-tier list rotates upstream. Two defenses:
 *   1. DEFAULT_FREE_TIER_LADDER — static fallback, empirically ordered.
 *   2. refreshFreeTierLadder() — hits /models at startup or lazily on
 *      cache miss and replaces with the live :free list.
 */

export const DEFAULT_FREE_TIER_LADDER: readonly string[] = [
  'nvidia/nemotron-3-ultra-550b-a55b:free',
  'minimax/minimax-m3:free',
  'thinkingmachines/inkling:free',
  'thinkingmachines/inkling-small:free',
  'nvidia/nemotron-3.5-lightning:free',
  'z-ai/glm-5.2:free',
  'cohere/north-mini-code:free',
  'poolside/laguna-s-2.1:free',
  'poolside/laguna-xs-2.1:free',
  'dots-studio/dots-3-note-preview:free',
  'liquid/lfm-2.5-2.6b:free',
  'nvidia/nemotron-3.5-content-safety:free',
];

export const FREE_TIER_TASK_MAP: Readonly<Record<string, string>> = {
  reasoning: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  code_gen: 'cohere/north-mini-code:free',
  code_review: 'poolside/laguna-s-2.1:free',
  summarize: 'nvidia/nemotron-3.5-lightning:free',
  json_extract: 'nvidia/nemotron-3.5-lightning:free',
  long_context: 'minimax/minimax-m3:free',
  fast_chat: 'liquid/lfm-2.5-2.6b:free',
  safety_check: 'nvidia/nemotron-3.5-content-safety:free',
} as const;

export const PAID_TIER_TASK_MAP: Readonly<Record<string, string>> = {
  reasoning: 'anthropic/claude-3.5-sonnet',
  code_gen: 'anthropic/claude-3.5-sonnet',
  code_review: 'anthropic/claude-3.5-sonnet',
  summarize: 'openai/gpt-4o-mini',
  json_extract: 'openai/gpt-4o-mini',
  long_context: 'anthropic/claude-3.5-sonnet',
  fast_chat: 'openai/gpt-4o-mini',
  safety_check: 'openai/gpt-4o-mini',
} as const;

let cachedFreeLadder: readonly string[] | null = null;

export async function refreshFreeTierLadder(
  apiKey: string,
  baseUrl = 'https://openrouter.ai/api/v1',
): Promise<readonly string[]> {
  try {
    const res = await fetch(`${baseUrl}/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!res.ok) return cachedFreeLadder ?? DEFAULT_FREE_TIER_LADDER;
    const body = (await res.json()) as { data?: Array<{ id: string; context_length?: number }> };
    const free = (body.data ?? []).filter((m) => m.id.endsWith(':free'));
    if (free.length === 0) return cachedFreeLadder ?? DEFAULT_FREE_TIER_LADDER;
    free.sort((a, b) => (b.context_length ?? 0) - (a.context_length ?? 0));
    const live = free.map((m) => m.id);
    cachedFreeLadder = live;
    return live;
  } catch {
    return cachedFreeLadder ?? DEFAULT_FREE_TIER_LADDER;
  }
}

export function getFreeTierLadder(): readonly string[] {
  return cachedFreeLadder ?? DEFAULT_FREE_TIER_LADDER;
}
