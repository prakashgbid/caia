/**
 * Cross-sub-agent aggregation policy.
 *
 * Reference: spec §4.7 + §4.1.
 *
 * The precedence ladder for resolving sub-agent disagreement:
 *   1. EA Plan Reviewer (governance correctness — always wins ties)
 *   2. EA Ticket Auditor (operational completeness)
 *   3. EA Drift Sentinel (policy enforcement)
 *   4. EA Doc Steward (audit-trail integrity)
 *   5. EA Research Conductor (advisory — never blocks)
 */

import type {
  CoordinatorReviewOutcome,
  SubAgentId,
  SubAgentVerdict
} from './coordinator-types.js';
import type { AffectedAdr, NewAdrDraft, OperatorEscalation, ReviewStatus } from './types.js';

/** Precedence rank — lower number wins. */
const RANK: Record<SubAgentId, number> = {
  'ea-plan-reviewer': 1,
  'ea-ticket-auditor': 2,
  'ea-drift-sentinel': 3,
  'ea-doc-steward': 4,
  'ea-research-conductor': 5
};

/**
 * Pick the dominant sub-agent verdict per the ladder.
 *
 * If only one verdict, that's the dominant. Otherwise:
 *   - if a verdict is 'rejected' or escalates, that wins (worse always wins).
 *   - else apply the precedence ladder.
 */
export function pickDominantVerdict(verdicts: SubAgentVerdict[]): {
  dominant: SubAgentVerdict;
  dissenting: SubAgentVerdict[];
} {
  if (verdicts.length === 0) {
    throw new Error('pickDominantVerdict: no verdicts to aggregate');
  }
  if (verdicts.length === 1) {
    const only = verdicts[0];
    if (only === undefined) throw new Error('unexpected');
    return { dominant: only, dissenting: [] };
  }
  // Sort: rejected/escalation wins over non-rejected; within same status,
  // precedence rank wins.
  const sorted = [...verdicts].sort((a, b) => {
    const aSeverity = severityScore(a.status);
    const bSeverity = severityScore(b.status);
    if (aSeverity !== bSeverity) return bSeverity - aSeverity;
    return RANK[a.subAgent] - RANK[b.subAgent];
  });
  const dominant = sorted[0];
  if (dominant === undefined) throw new Error('unexpected');
  const dissenting = sorted.slice(1).filter((v) => {
    // Only count as dissent if their verdict materially disagreed.
    return verdictMaterialDisagreement(dominant, v);
  });
  return { dominant, dissenting };
}

/**
 * Compose a CoordinatorReviewOutcome from a set of sub-agent verdicts.
 */
export function aggregateVerdicts(args: {
  submissionId: string;
  iteration: number;
  verdicts: SubAgentVerdict[];
  reviewedAtIso: string;
  signoffPath: string;
}): Omit<CoordinatorReviewOutcome, 'subAgentsInvoked'> {
  const { dominant, dissenting } = pickDominantVerdict(args.verdicts);
  const cited_adrs = dedup(args.verdicts.flatMap((v) => v.cited_adrs ?? []));
  const cited_principles = dedup(args.verdicts.flatMap((v) => v.cited_principles ?? []));
  const cited_lessons = dedup(args.verdicts.flatMap((v) => v.cited_lessons ?? []));
  const requested_modifications = dedup(args.verdicts.flatMap((v) => v.requested_modifications ?? []));
  const new_adrs_to_file: NewAdrDraft[] = args.verdicts.flatMap(
    (v) => v.new_adrs_to_file ?? []
  );
  const affected_existing_adrs: AffectedAdr[] = args.verdicts.flatMap(
    (v) => v.affected_existing_adrs ?? []
  );
  const escalation: OperatorEscalation | undefined =
    dominant.escalation_to_operator ??
    args.verdicts.find((v) => v.escalation_to_operator !== undefined)?.escalation_to_operator;

  const status: ReviewStatus = projectStatus(dominant.status);

  const defenderRoundsUsed = args.verdicts.reduce(
    (n, v) => n + (typeof v.defenderRoundsUsed === 'number' ? v.defenderRoundsUsed : 0),
    0
  );
  const dialogueLogPath = args.verdicts.find((v) => typeof v.dialogueLogPath === 'string')?.dialogueLogPath;

  const reasoning = composeReasoning(dominant, dissenting, args.verdicts);

  return {
    status,
    reasoning,
    submissionId: args.submissionId,
    iteration: args.iteration,
    subAgentVerdicts: args.verdicts,
    dissenting,
    cited_adrs,
    cited_principles,
    cited_lessons,
    requested_modifications,
    new_adrs_to_file,
    affected_existing_adrs,
    ...(escalation !== undefined ? { escalation_to_operator: escalation } : {}),
    signoffPath: args.signoffPath,
    ...(dialogueLogPath !== undefined ? { dialogueLogPath } : {}),
    defenderRoundsUsed,
    reviewedAtIso: args.reviewedAtIso
  };
}

/** Map a sub-agent verdict status to a ReviewStatus the existing API expects. */
function projectStatus(s: SubAgentVerdict['status']): ReviewStatus {
  if (s === 'approved' || s === 'approved-with-modifications' || s === 'rejected' || s === 'needs-clarification') {
    return s;
  }
  if (s === 'pass') return 'approved';
  if (s === 'fail') return 'rejected';
  // 'advisory' status — never blocks; project to approved.
  return 'approved';
}

function severityScore(s: SubAgentVerdict['status']): number {
  switch (s) {
    case 'rejected':
    case 'fail':
      return 4;
    case 'needs-clarification':
      return 3;
    case 'approved-with-modifications':
      return 2;
    case 'pass':
    case 'approved':
      return 1;
    case 'advisory':
      return 0;
    default:
      return 0;
  }
}

function dedup<T>(arr: T[]): T[] {
  return [...new Set(arr)];
}

function composeReasoning(
  dominant: SubAgentVerdict,
  dissenting: SubAgentVerdict[],
  all: SubAgentVerdict[]
): string {
  const parts: string[] = [];
  parts.push(`Dominant verdict from ${dominant.subAgent}: ${dominant.status}. ${dominant.reasoning}`);
  if (all.length > 1) {
    parts.push(`Sub-agents invoked: ${all.map((v) => `${v.subAgent} (${v.status})`).join(', ')}.`);
  }
  if (dissenting.length > 0) {
    parts.push(`Dissent: ${dissenting.map((v) => `${v.subAgent} (${v.status}) — ${oneLine(v.reasoning)}`).join('; ')}.`);
  }
  return parts.join(' ');
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 150);
}

function verdictMaterialDisagreement(dominant: SubAgentVerdict, other: SubAgentVerdict): boolean {
  // Advisory verdicts never dissent.
  if (other.status === 'advisory') return false;
  // Same status — no disagreement.
  if (other.status === dominant.status) return false;
  return true;
}
