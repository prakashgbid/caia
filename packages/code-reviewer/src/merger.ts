/**
 * FindingMerger + verdict synthesis.
 *
 * Inputs:
 *   - deterministic findings (already have id, source, detectorId; reserved
 *     for Phase 2 — phase 1 ships LLM-only)
 *   - LLM-reasoned findings (omit id, source, detectorId — we add them)
 *
 * Output: a single deduped, severity-floored, deterministic-ordered list,
 * AND a binary `verdict` (`approve` | `request-changes`) computed from the
 * presence of findings at or above `blockingSeverityThreshold`.
 *
 * Verdict synthesis rule:
 *   verdict = (blockingFindings.length > 0) ? 'request-changes' : 'approve'
 *   where blockingFindings = findings.filter(f => severity >= blockingSeverityThreshold)
 *
 * Drop-on-overlap behavior: any finding whose `dimension` lands on Critic's
 * or advisory Reviewer's denylist is dropped from the output AND counted in
 * `redirectsToCritic` / `redirectsToReviewer`. Defense in depth on top of
 * the prompt-level non-overlap instruction and the LLM-tier sanitiser.
 */

import type {
  CodeReviewFinding,
  CodeReviewSeverity,
  LlmReviewOutput,
  ReviewSummary,
  Verdict
} from './types.js';
import {
  ADVISORY_REVIEWER_DENYLIST,
  ALL_DIMENSIONS,
  CRITIC_DENYLIST,
  SEVERITY_RANK
} from './types.js';
import { findingId } from './finding-id.js';

export interface MergeArgs {
  deterministic: readonly CodeReviewFinding[];
  llmReasoned: LlmReviewOutput;
  severityFloor: CodeReviewSeverity;
  blockingSeverityThreshold: CodeReviewSeverity;
  maxFindings: number;
  llmEnabled: boolean;
  chunksReviewed: number;
  durationMs: number;
}

export interface MergeResult {
  findings: CodeReviewFinding[];
  blockingFindings: CodeReviewFinding[];
  verdict: Verdict;
  summary: ReviewSummary;
}

export function mergeFindings(args: MergeArgs): MergeResult {
  const {
    deterministic,
    llmReasoned,
    severityFloor,
    blockingSeverityThreshold,
    maxFindings,
    llmEnabled,
    chunksReviewed,
    durationMs
  } = args;

  // Defense in depth — drop anything whose dimension falls on either
  // sibling's denylist. Counted into the summary so operators can see if
  // the LLM keeps wandering into sibling domains.
  let redirectsToCritic = 0;
  let redirectsToReviewer = 0;
  const llmKept = llmReasoned.findings.filter(f => {
    if (CRITIC_DENYLIST.has(f.dimension)) {
      redirectsToCritic++;
      return false;
    }
    if (ADVISORY_REVIEWER_DENYLIST.has(f.dimension)) {
      redirectsToReviewer++;
      return false;
    }
    return true;
  });

  const llmHydrated: CodeReviewFinding[] = llmKept.map(f => ({
    ...f,
    id: findingId({ dimension: f.dimension, file: f.file, line: f.line, issueTitle: f.issueTitle }),
    source: 'llm-reasoned' as const,
    detectorId: 'llm-reviewer'
  }));

  const all = [...deterministic, ...llmHydrated];

  // Dedup by id — first occurrence wins (deterministic precedence over LLM).
  const seen = new Set<string>();
  const deduped: CodeReviewFinding[] = [];
  for (const f of all) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    deduped.push(f);
  }

  // Severity floor — drop anything below.
  const floorRank = SEVERITY_RANK[severityFloor];
  const floored = deduped.filter(f => SEVERITY_RANK[f.severity] >= floorRank);

  // Stable sort: severity desc, then dimension index asc, then file, then line.
  floored.sort((a, b) => {
    const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sd !== 0) return sd;
    const ci = ALL_DIMENSIONS.indexOf(a.dimension) - ALL_DIMENSIONS.indexOf(b.dimension);
    if (ci !== 0) return ci;
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.line - b.line;
  });

  const capped = floored.slice(0, maxFindings);

  // Verdict synthesis — request-changes iff any finding is at or above
  // the blocking threshold.
  const blockingRank = SEVERITY_RANK[blockingSeverityThreshold];
  const blockingFindings = capped.filter(f => SEVERITY_RANK[f.severity] >= blockingRank);
  const verdict: Verdict = blockingFindings.length > 0 ? 'request-changes' : 'approve';

  const countBySeverity: Record<CodeReviewSeverity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const countByDimension: ReviewSummary['countByDimension'] = {};
  for (const f of capped) {
    countBySeverity[f.severity]++;
    countByDimension[f.dimension] = (countByDimension[f.dimension] ?? 0) + 1;
  }
  const detCount = capped.filter(f => f.source === 'deterministic').length;
  const llmCount = capped.filter(f => f.source === 'llm-reasoned').length;

  const summary: ReviewSummary = {
    countBySeverity,
    countByDimension,
    chunksReviewed,
    durationMs,
    deterministic: detCount,
    llmReasoned: llmCount,
    llmEnabled,
    llmReasoningSucceeded: !llmEnabled || llmReasoned.ok,
    redirectsToCritic,
    redirectsToReviewer
  };

  return { findings: capped, blockingFindings, verdict, summary };
}
