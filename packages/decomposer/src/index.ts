export { decomposeRuleBased } from './rule-based.js';
export { decomposeWithClaude } from './claude-decomposer.js';
export type { DecompositionNode, DecompositionResult, DecomposerConfig } from './types.js';

/**
 * Decompose a natural language prompt into a structured Initiative → Epic → Story → Task hierarchy.
 *
 * Tries Claude first (if ANTHROPIC_API_KEY is present), falls back to the
 * deterministic rule-based engine so that tests and CI never need an API key.
 */
export async function decompose(
  prompt: string,
  config: import('./types.js').DecomposerConfig = {},
): Promise<import('./types.js').DecompositionResult> {
  const apiKey = (config as { claudeApiKey?: string }).claudeApiKey ?? process.env['ANTHROPIC_API_KEY'];

  if (apiKey) {
    try {
      const { decomposeWithClaude } = await import('./claude-decomposer.js');
      return await decomposeWithClaude(prompt, config);
    } catch (e) {
      console.warn('[decomposer] Claude decomposition failed, falling back to rule-based:', e);
    }
  }

  const { decomposeRuleBased } = await import('./rule-based.js');
  return decomposeRuleBased(prompt, config);
}
