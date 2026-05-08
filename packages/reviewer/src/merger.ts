/**
 * FindingMerger — dedup by id-hash, severity floor, drop Critic overlap.
 *
 * Inputs:
 *   - deterministic findings (already have id, source, detectorId)
 *   - LLM-reasoned findings (omit id, source, detectorId — we add them)
 *
 * Output: a single deduped, severity-floored, deterministic-ordered list.
 *
 * Reviewer's merger has an explicit Critic-overlap drop step — any LLM
 * finding whose `dimension` lands on Critic's denylist is dropped. This is
 * defense-in-depth on top of the prompt-level non-overlap instruction.
 */

import type {
  CraftsmanshipFinding,
  CraftsmanshipSeverity,
  LlmReviewOutput,
  ReviewSummary
} from './types.js';
import {
  ALL_DIMENSIONS,
  CRITIC_DENYLIST,
  SEVERITY_RANK
} from './types.js';
import { findingId } from './detectors/shared.js';

export interface MergeArgs {
  deterministic: readonly CraftsmanshipFinding[];
  llmReasoned: LlmReviewOutput;
  severityFloor: CraftsmanshipSeverity;
  maxFindings: number;
  llmEnabled: boolean;
  chunksReviewed: number;
  durationMs: number;
}

export interface MergeResult {
  findings: CraftsmanshipFinding[];
  summary: ReviewSummary;
}

export function mergeFindings(args: MergeArgs): MergeResult {
  const { deterministic, llmReasoned, severityFloor, maxFindings, llmEnabled, chunksReviewed, durationMs } = args;

  // Filter LLM findings against Critic's denylist — sanitiseLlmFinding
  // already drops these but defense-in-depth at the merger guards future
  // changes that bypass the sanitiser.
  let redirectsToCritic = 0;
  const llmKept = llmReasoned.findings.filter(f => {
    if (CRITIC_DENYLIST.has(f.dimension)) {
      redirectsToCritic++;
      return false;
    }
    return true;
  });

  const llmHydrated: CraftsmanshipFinding[] = llmKept.map(f => ({
    ...f,
    id: findingId({ dimension: f.dimension, file: f.file, line: f.line, suggestionTitle: f.suggestionTitle }),
    source: 'llm-reasoned' as const,
    detectorId: 'llm-reviewer'
  }));

  const all = [...deterministic, ...llmHydrated];

  // Dedup by id — first occurrence wins (deterministic precedence over llm
  // for stable output).
  const seen = new Set<string>();
  const deduped: CraftsmanshipFinding[] = [];
  for (const f of all) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    deduped.push(f);
  }

  // Severity floor — drop anything below.
  const floorRank = SEVERITY_RANK[severityFloor];
  const floored = deduped.filter(f => SEVERITY_RANK[f.severity] >= floorRank);

  // Stable sort: praise first (positive reinforcement leads), then severity desc, then dimension index asc, then file asc, then line asc.
  floored.sort((a, b) => {
    // Praise findings always lead — surfaces wins before suggestions.
    if (a.severity === 'praise' && b.severity !== 'praise') return -1;
    if (b.severity === 'praise' && a.severity !== 'praise') return 1;
    const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sd !== 0) return sd;
    const ci = ALL_DIMENSIONS.indexOf(a.dimension) - ALL_DIMENSIONS.indexOf(b.dimension);
    if (ci !== 0) return ci;
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.line - b.line;
  });

  const capped = floored.slice(0, maxFindings);

  const countBySeverity: Record<CraftsmanshipSeverity, number> = { praise: 0, nit: 0, suggestion: 0, consider: 0 };
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
    redirectsToCritic
  };

  return { findings: capped, summary };
}
