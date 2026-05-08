/**
 * Implementation of `reviewPromptPattern()`.
 */

import type { ReviewPromptPatternParams, ReviewResult, PromptFinding } from './types.js';
import {
  PROMPT_PATTERN_RULES,
  scoreFromFindings,
  type PromptCheckInput
} from './knowledge/prompt-patterns.js';
import { decideDspyCompile } from './knowledge/dspy-heuristics.js';

export function reviewPromptPattern(
  params: ReviewPromptPatternParams
): ReviewResult {
  const checkInput: PromptCheckInput = {
    template: params.template,
    intendedTaskCategory: params.intendedTaskCategory,
    expectedOutputShape: params.expectedOutputShape ?? 'plain'
  };

  const findings: PromptFinding[] = [];
  for (const rule of PROMPT_PATTERN_RULES) {
    findings.push(...rule.check(checkInput));
  }

  const score = scoreFromFindings(findings);
  const dspyVerdict = decideDspyCompile(params.intendedTaskCategory);

  const rewriteSuggestion =
    score < 0.5 ? buildRewriteSuggestion(params, findings) : undefined;

  return rewriteSuggestion === undefined
    ? {
        score,
        findings,
        recommendDspyCompile: dspyVerdict.recommend,
        ...(dspyVerdict.recommend
          ? { recommendDspyCompileReason: dspyVerdict.reason }
          : {})
      }
    : {
        score,
        findings,
        recommendDspyCompile: dspyVerdict.recommend,
        ...(dspyVerdict.recommend
          ? { recommendDspyCompileReason: dspyVerdict.reason }
          : {}),
        rewriteSuggestion
      };
}

function buildRewriteSuggestion(
  params: ReviewPromptPatternParams,
  findings: ReadonlyArray<PromptFinding>
): string {
  const lines: string[] = [];
  lines.push(`# Suggested rewrite for ${params.templateId}`);
  lines.push('');
  lines.push('You are a CAIA agent operating on this task:');
  lines.push(`  Task: ${params.intendedTaskCategory}`);
  lines.push('');
  if (params.expectedOutputShape && params.expectedOutputShape !== 'plain') {
    lines.push(
      `Output shape: ${params.expectedOutputShape}. Wrap output in a ` +
        `\`\`\`${params.expectedOutputShape}\`\`\` block.`
    );
    lines.push('');
  }
  lines.push('Think through this step by step before responding.');
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('# Findings to address before adopting the rewrite:');
  for (const f of findings) {
    if (f.severity !== 'info') {
      lines.push(`- [${f.severity}] (${f.pattern}) ${f.recommendation}`);
    }
  }
  return lines.join('\n');
}
