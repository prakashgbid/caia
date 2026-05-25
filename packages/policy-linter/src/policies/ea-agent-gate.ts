/**
 * Policy: `ea-agent-gate`
 *
 * Maps to spec `p006-ea-agent-gates-research.ts` (lines 598, 622, 631-639)
 * and ADR-015.
 *
 * Rule: if `intent in ['research','spec']` (or `intent==='build'` and the
 * target affects architecture-significant files), require evidence the plan
 * was submitted to `@caia/ea-architect.submitPlan`.
 *
 * Evidence accepted (any one is sufficient):
 *   1. `ctx.eaPlanSubmissionId` present and non-empty.
 *   2. Brief contains an "ea_plan_submission_id" / "submissionId:" frontmatter line.
 *   3. Brief contains a reference to `@caia/ea-architect.submitPlan` invocation.
 *   4. Brief documents a deferred-review queue write (per spec line 639
 *      bootstrap exception): mentions `EA_REVIEW_QUEUE.md`.
 *
 * Mode: `hard-fail` per spec (after grace period). Grace period flag:
 * `ctx.metadata.eaGateGracePeriod === true` downgrades to `soft-fail`.
 *
 * Architecture-significant files (from spec routing heuristic):
 *   - paths matching `caia-ea/**`
 *   - paths matching `packages/*\/package.json`
 *   - paths matching `**\/principles/**` or `**\/decisions/ADR-*.md`
 */

import type {
  DispatchContext,
  Policy,
  PolicyEvidence,
  PolicyMode,
  PolicyVerdict
} from '../types.js';

const SUBMISSION_FRONTMATTER_PATTERNS: ReadonlyArray<RegExp> = [
  /\bea_plan_submission_id\s*:\s*\S+/i,
  /\bsubmissionId\s*:\s*\S+/i,
  /\bea-architect\.submitPlan\s*\(/i,
  /\bsubmitPlan\s*\(\s*{/i,
  /EA_REVIEW_QUEUE\.md/i
];

const ARCHITECTURE_SIGNIFICANT_PATTERNS: ReadonlyArray<RegExp> = [
  /^caia-ea\//,
  /\/caia-ea\//,
  /packages\/[^/]+\/package\.json$/,
  /\/principles\//,
  /\/decisions\/ADR-\d+/i,
  /\/risks?\//,
  /\/lessons-learned\//
];

export function looksLikeArchitectureSignificant(
  paths: ReadonlyArray<string>
): boolean {
  return paths.some((p) =>
    ARCHITECTURE_SIGNIFICANT_PATTERNS.some((rx) => rx.test(p))
  );
}

export function findSubmissionEvidence(
  ctx: DispatchContext
): ReadonlyArray<PolicyEvidence> {
  const evidence: PolicyEvidence[] = [];
  if (
    typeof ctx.eaPlanSubmissionId === 'string' &&
    ctx.eaPlanSubmissionId.trim().length > 0
  ) {
    evidence.push({
      source: 'dispatchContext.eaPlanSubmissionId',
      snippet: ctx.eaPlanSubmissionId
    });
    return evidence;
  }
  const lines = ctx.briefMd.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    for (const rx of SUBMISSION_FRONTMATTER_PATTERNS) {
      if (rx.test(line)) {
        evidence.push({
          source: 'brief',
          line: i + 1,
          snippet: line.length > 200 ? `${line.slice(0, 199)}…` : line
        });
      }
    }
  }
  return evidence;
}

function gateApplies(ctx: DispatchContext): boolean {
  if (ctx.intent === 'research' || ctx.intent === 'spec' || ctx.intent === 'meta') {
    return true;
  }
  if (ctx.intent === 'build') {
    // For build intent, only gate if it touches architecture-significant files.
    const significant = looksLikeArchitectureSignificant([
      ...ctx.targetRepos,
      ...(Array.isArray(ctx.metadata?.['changedFiles'])
        ? (ctx.metadata!['changedFiles'] as ReadonlyArray<string>)
        : [])
    ]);
    return significant;
  }
  return false;
}

export const eaAgentGatePolicy: Policy = {
  id: 'ea-agent-gate',
  description:
    'Research, spec, meta, and architecture-significant build dispatches must show evidence of submission to @caia/ea-architect.submitPlan. Source: ADR-015 / feedback-ea-agent-gates-research.',
  defaultMode: 'hard-fail',
  async check(ctx: DispatchContext): Promise<PolicyVerdict> {
    if (!gateApplies(ctx)) {
      return { ok: true };
    }
    const evidence = findSubmissionEvidence(ctx);
    if (evidence.length > 0) {
      return { ok: true };
    }
    const grace = ctx.metadata?.['eaGateGracePeriod'] === true;
    const mode: PolicyMode = grace ? 'soft-fail' : 'hard-fail';
    return {
      ok: false,
      mode,
      reason: `Dispatch intent="${ctx.intent}" requires EA Architect plan submission. No evidence of submitPlan call or EA_REVIEW_QUEUE.md write found in brief or context.`,
      suggestedFix:
        'Submit the plan to @caia/ea-architect.submitPlan before dispatching. If the CLI is not yet built, append the plan markdown to ~/Documents/projects/agent-memory/EA_REVIEW_QUEUE.md per spec line 639 deferred-review mode, then re-run the linter.'
    };
  }
};
