/**
 * FindingMerger — dedup by id-hash, severity floor, taxonomy classify.
 *
 * Inputs:
 *   - deterministic findings (already have id, source, detectorId)
 *   - LLM-reasoned findings (omit id, source, detectorId — we add them)
 *
 * Output: a single deduped, severity-floored, deterministic-ordered list.
 */

import type {
  AdversarialFinding,
  LlmReasonOutput,
  ReviewSummary,
  Severity
} from './types.js';
import {
  ALL_FAILURE_MODES,
  SEVERITY_RANK
} from './types.js';
import { findingId } from './detectors/shared.js';

export interface MergeArgs {
  deterministic: readonly AdversarialFinding[];
  llmReasoned: LlmReasonOutput;
  severityFloor: Severity;
  maxFindings: number;
  llmEnabled: boolean;
  chunksReviewed: number;
  durationMs: number;
}

export interface MergeResult {
  findings: AdversarialFinding[];
  blockingFindings: AdversarialFinding[];
  summary: ReviewSummary;
}

export function mergeFindings(args: MergeArgs): MergeResult {
  const { deterministic, llmReasoned, severityFloor, maxFindings, llmEnabled, chunksReviewed, durationMs } = args;

  const llmHydrated: AdversarialFinding[] = llmReasoned.findings.map(f => ({
    ...f,
    id: findingId({ category: f.category, file: f.file, line: f.line, attackVector: f.attackVector }),
    source: 'llm-reasoned' as const,
    detectorId: 'llm-reasoner'
  }));

  const all = [...deterministic, ...llmHydrated];

  // Dedup by id — first occurrence wins (deterministic precedence over llm
  // for stable output).
  const seen = new Set<string>();
  const deduped: AdversarialFinding[] = [];
  for (const f of all) {
    if (seen.has(f.id)) continue;
    seen.add(f.id);
    deduped.push(f);
  }

  // Severity floor — drop anything below.
  const floorRank = SEVERITY_RANK[severityFloor];
  const floored = deduped.filter(f => SEVERITY_RANK[f.severity] >= floorRank);

  // Stable sort: severity desc, then category index asc, then file asc, then line asc.
  floored.sort((a, b) => {
    const sd = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
    if (sd !== 0) return sd;
    const ci = ALL_FAILURE_MODES.indexOf(a.category) - ALL_FAILURE_MODES.indexOf(b.category);
    if (ci !== 0) return ci;
    if (a.file < b.file) return -1;
    if (a.file > b.file) return 1;
    return a.line - b.line;
  });

  // Cap.
  const capped = floored.slice(0, maxFindings);

  const blockingFindings = capped.filter(f => SEVERITY_RANK[f.severity] >= SEVERITY_RANK['high']);

  const countBySeverity: Record<Severity, number> = { low: 0, medium: 0, high: 0, critical: 0 };
  const countByCategory: ReviewSummary['countByCategory'] = {};
  for (const f of capped) {
    countBySeverity[f.severity]++;
    countByCategory[f.category] = (countByCategory[f.category] ?? 0) + 1;
  }
  const detCount = capped.filter(f => f.source === 'deterministic').length;
  const llmCount = capped.filter(f => f.source === 'llm-reasoned').length;

  const summary: ReviewSummary = {
    countBySeverity,
    countByCategory,
    chunksReviewed,
    durationMs,
    deterministic: detCount,
    llmReasoned: llmCount,
    llmEnabled,
    llmReasoningSucceeded: !llmEnabled || llmReasoned.ok
  };

  return { findings: capped, blockingFindings, summary };
}
