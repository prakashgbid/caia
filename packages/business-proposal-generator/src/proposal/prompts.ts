import type { IaArtifactSet } from '../types/ia.js';
import type { BusinessPlanV2 } from '../types/proposal.js';

const PRELUDE = 'You are the CAIA Stage 5 proposal renderer. Output Markdown only. ATX headings. No placeholders. Match plan.sections.branding.voice. Do not invent decisions.';

function summary(plan: BusinessPlanV2, ia: IaArtifactSet): string {
  const s = (plan.sections ?? {}) as Record<string, unknown>;
  const keys = Object.keys(s).slice(0, 30).join(', ') || '(none)';
  const voice = (s['branding'] as { voice?: string } | undefined)?.voice ?? 'unspecified';
  return 'Sections: ' + keys + '\nIA pages: ' + ia.pages.pages.length + '\nAccent: ' + ia.designSystem.palette.accent + '\nVoice: ' + voice + '\nScore: ' + plan.rubricScores.aggregateScore;
}

export function execSummaryPrompt(plan: BusinessPlanV2, ia: IaArtifactSet): string {
  return [PRELUDE, 'TASK: EXECUTIVE SUMMARY <=400 words. H2 sections: Problem; Target user; Proposed product; Differentiation; Success metric; 90-day milestone.', summary(plan, ia), 'Plan: ' + JSON.stringify(plan).slice(0, 20000)].join('\n\n');
}

export function fullProposalPrompt(plan: BusinessPlanV2, ia: IaArtifactSet, execSummaryMd: string): string {
  return [PRELUDE, 'TASK: FULL PROPOSAL 2500-12500 words. >=1 H1, >=4 H2. Section 0 (## Executive Summary) repastes the exec summary verbatim.', 'Exec summary:\n' + execSummaryMd, summary(plan, ia), 'IA: ' + JSON.stringify(ia).slice(0, 30000), 'Plan: ' + JSON.stringify(plan).slice(0, 30000)].join('\n\n');
}

export function onePagerPrompt(plan: BusinessPlanV2, ia: IaArtifactSet): string {
  return [PRELUDE, 'TASK: ONE-PAGER <=320 words. H2 blocks: name+tagline; audience+voice; in-scope (max 12 bullets); out-of-scope (max 6); success metric.', summary(plan, ia), 'Plan: ' + JSON.stringify(plan).slice(0, 20000)].join('\n\n');
}
