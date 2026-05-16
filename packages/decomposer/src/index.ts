import { createLogger } from '@chiefaia/logger';

export { decomposeRuleBased } from './rule-based';
export { decomposeWithClaude } from './claude-decomposer';
export type { DecompositionNode, DecompositionResult, DecomposerConfig } from './types';

const logger = createLogger({ name: 'decomposer' });

/**
 * Decompose a natural language prompt into a structured Initiative → Epic → Story → Task hierarchy.
 *
 * Tries Claude first (if ANTHROPIC_API_KEY is present), falls back to the
 * deterministic rule-based engine so that tests and CI never need an API key.
 */
export async function decompose(
  prompt: string,
  config: import('./types').DecomposerConfig = {},
): Promise<import('./types').DecompositionResult> {
  const apiKey = (config as { claudeApiKey?: string }).claudeApiKey ?? process.env['ANTHROPIC_API_KEY'];

  if (apiKey) {
    try {
      const { decomposeWithClaude } = await import('./claude-decomposer');
      return await decomposeWithClaude(prompt, config);
    } catch (e) {
      logger.warn('Claude decomposition failed, falling back to rule-based', {
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  const { decomposeRuleBased } = await import('./rule-based');
  return decomposeRuleBased(prompt, config);
}
