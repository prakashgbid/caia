import { ProposalGeneratorError } from '../errors.js';
import type { LlmCaller } from '../llm.js';
import type { IaArtifactSet } from '../types/ia.js';
import type { BusinessPlanV2 } from '../types/proposal.js';
import { fullProposalPrompt } from './prompts.js';
import { stripWrapping } from './render-exec-summary.js';
import { FULL_PROPOSAL_BOUNDS, assertWithinBounds } from './word-count.js';

export async function renderFullProposal(args: {
  llmCaller: LlmCaller;
  plan: BusinessPlanV2;
  ia: IaArtifactSet;
  execSummaryMd: string;
}): Promise<string> {
  const prompt = fullProposalPrompt(args.plan, args.ia, args.execSummaryMd);
  const result = await args.llmCaller.call(prompt, { modelHint: 'sonnet', maxBudgetMs: 180_000 });
  if (!result.ok) {
    throw new ProposalGeneratorError('llm_call_failed', 'full-proposal renderer failed', undefined, {
      stage: 'full-proposal',
      diagnostic: result.diagnostic,
    });
  }
  const md = stripWrapping(result.text);
  assertWithinBounds('full-proposal', md, FULL_PROPOSAL_BOUNDS);
  return md;
}
