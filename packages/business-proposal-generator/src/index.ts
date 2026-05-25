/** @caia/business-proposal-generator — public surface (Stage 5). */
export {
  NotImplementedError,
  PandocError,
  PandocNotFoundError,
  ProposalGeneratorError,
  isProposalGeneratorError,
} from './errors.js';
export type { ProposalGeneratorErrorCode } from './errors.js';
export * from './types/index.js';
export { DefaultLlmCaller, ScriptedLlmCaller, extractJsonObject } from './llm.js';
export type { LlmCallOptions, LlmCallResult, LlmCaller, ScriptedResponse } from './llm.js';
export { canonicalJson, diffBusinessPlans, hashBusinessPlan } from './revisions.js';
export type { DiffSummary } from './revisions.js';
export { renderExecSummary, stripWrapping } from './proposal/render-exec-summary.js';
export { renderFullProposal } from './proposal/render-full.js';
export { renderOnePager } from './proposal/render-one-pager.js';
export {
  EXEC_SUMMARY_BOUNDS,
  FULL_PROPOSAL_BOUNDS,
  ONE_PAGER_BOUNDS,
  assertWithinBounds,
  countHeadings,
  countWords,
} from './proposal/word-count.js';
export type { DocBounds } from './proposal/word-count.js';
export { execSummaryPrompt, fullProposalPrompt, onePagerPrompt } from './proposal/prompts.js';
export { NodePandocRunner, runPandoc } from './conversion/pandoc.js';
export type { PandocRunner, PandocRunResult } from './conversion/pandoc.js';
export { convertMarkdownToPdf } from './conversion/markdown-to-pdf.js';
export { convertMarkdownToDocx } from './conversion/markdown-to-docx.js';
export * from './storage/index.js';
export * from './design-app/index.js';
export * from './reviewer/index.js';
export { ProposalGenerator, runStep5 } from './orchestrator.js';
export type { ProposalGeneratorOptions } from './orchestrator.js';

export const BUSINESS_PROPOSAL_GENERATOR_CONTRACT = Object.freeze({
  agentId: '@caia/business-proposal-generator' as const,
  role: 'pipeline-stage-5-proposal' as const,
  fsmTransitions: [
    { from: 'interview-complete' as const, to: 'proposal-generated' as const, reason: 'proposal-generated' as const },
  ],
  consumesEvents: [] as const,
  emitsEvents: ['business_proposal.ready' as const] as const,
  artifacts: {
    reads: ['caia_<tenant>.interviews', 'caia_<tenant>.business_plan_revisions'] as const,
    writes: [
      'caia_<tenant>.business_proposals',
      'caia_<tenant>.designapp_prompts',
      'caia_<tenant>.proposal_revisions',
    ] as const,
  },
});
