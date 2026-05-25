import { ProposalGeneratorError } from '../errors.js';
import type { LlmCaller } from '../llm.js';
import type { IaArtifactSet } from '../types/ia.js';
import type { BusinessPlanV2 } from '../types/proposal.js';
import { execSummaryPrompt } from './prompts.js';
import { EXEC_SUMMARY_BOUNDS, assertWithinBounds } from './word-count.js';

export async function renderExecSummary(args: {
  llmCaller: LlmCaller;
  plan: BusinessPlanV2;
  ia: IaArtifactSet;
}): Promise<string> {
  const prompt = execSummaryPrompt(args.plan, args.ia);
  const result = await args.llmCaller.call(prompt, { modelHint: 'sonnet', maxBudgetMs: 90_000 });
  if (!result.ok) {
    throw new ProposalGeneratorError('llm_call_failed', 'exec-summary renderer failed', undefined, {
      stage: 'exec-summary',
      diagnostic: result.diagnostic,
    });
  }
  const md = stripWrapping(result.text);
  assertWithinBounds('exec-summary', md, EXEC_SUMMARY_BOUNDS);
  return md;
}

export function stripWrapping(text: string): string {
  let s = text.trim();
  const fence = /^```(?:markdown|md)?\s*\n([\s\S]*?)\n```\s*$/i;
  const m = fence.exec(s);
  if (m && m[1]) s = m[1].trim();
  return s;
}
