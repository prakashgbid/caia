import { ProposalGeneratorError } from '../errors.js';
import type { LlmCaller } from '../llm.js';
import type { IaArtifactSet } from '../types/ia.js';
import type { BusinessPlanV2 } from '../types/proposal.js';
import { onePagerPrompt } from './prompts.js';
import { stripWrapping } from './render-exec-summary.js';
import { ONE_PAGER_BOUNDS, assertWithinBounds } from './word-count.js';

export async function renderOnePager(args: {
  llmCaller: LlmCaller;
  plan: BusinessPlanV2;
  ia: IaArtifactSet;
}): Promise<string> {
  const prompt = onePagerPrompt(args.plan, args.ia);
  const result = await args.llmCaller.call(prompt, { modelHint: 'sonnet', maxBudgetMs: 60_000 });
  if (!result.ok) {
    throw new ProposalGeneratorError('llm_call_failed', 'one-pager renderer failed', undefined, {
      stage: 'one-pager',
      diagnostic: result.diagnostic,
    });
  }
  const md = stripWrapping(result.text);
  assertWithinBounds('one-pager', md, ONE_PAGER_BOUNDS);
  return md;
}
