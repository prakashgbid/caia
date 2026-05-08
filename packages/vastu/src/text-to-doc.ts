/**
 * Stage A — text → FormalDoc.
 *
 * Phase 1 STUB. Phase 2 will wire this to:
 *   - heuristic section-name detection (regex over the prose)
 *   - LLM-routed structured-output extraction via @chiefaia/local-llm-router
 *   - merge of the two into a typed FormalDoc
 *
 * For Phase 1 the stub produces a deterministic single-section "stub" doc so
 * downstream stages compile and the pipeline contract is exercisable.
 */

import type { FormalDoc } from './types.js';
import type { VastuConfig } from './config.js';

export interface TextToDocOptions {
  inputText: string;
  config: VastuConfig;
  pageId?: string;
}

/**
 * Produce a stub FormalDoc from the input text.
 *
 * The stub:
 *  - derives `id` from `pageId` or a short slug
 *  - puts the entire prose as a single section's intent
 *  - flags `origin: 'stub'` so callers know it isn't a real LLM extraction
 *
 * The function is intentionally synchronous in Phase 1; Phase 2's LLM call
 * will make it async. We keep the return type `Promise<FormalDoc>` already so
 * callers don't need to refactor when the implementation lands.
 */
export async function textToDoc(opts: TextToDocOptions): Promise<FormalDoc> {
  const { inputText, config, pageId } = opts;
  const trimmed = inputText.trim();
  if (!trimmed) {
    throw new Error('textToDoc: inputText is empty');
  }

  const id = pageId ?? (slugify(trimmed.slice(0, 40)) || 'page');

  return {
    id,
    name: humanise(id),
    audience: config.brandVoice.audience,
    brandVoice: config.brandVoice.tone,
    sections: [
      {
        id: 'stub-section',
        section: 'PlaceholderSection',
        intent: trimmed,
        height: config.defaultSectionHeight,
        props: {}
      }
    ],
    origin: 'stub'
  };
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function humanise(slug: string): string {
  if (!slug) return 'Page';
  return slug
    .split('-')
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
