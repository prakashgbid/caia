/**
 * Mentor Phase-2 — postmerge regression detection types.
 *
 * Phase 1 of Mentor (already shipped) reacts to operator chat
 * corrections. Phase 2 extends Mentor to react to *event-driven*
 * signals from the platform itself: PRs that merged + Evidence-Gate
 * checks that failed + post-merge bug reports. The shared output is
 * still the Phase-1 SynthesizedLesson shape — what differs is the
 * *input* (structured event payloads instead of free-form chat text).
 *
 * This module exports the type surface only. Classifier + synthesizer
 * implementations live alongside it but each has its own file so they
 * can be unit-tested in isolation.
 */

import type {
  ClassificationResult,
  FailureMode,
  Generalizability,
  Severity
} from '../types.js';

/** Re-export the Phase-1 result shape — the postmerge classifier produces the same. */
export type { ClassificationResult, FailureMode, Generalizability, Severity };

/**
 * Input contract for the postmerge classifier.
 *
 * The Phase-1 classifier takes free-form correction text. The Phase-2
 * postmerge classifier takes *structured* signals — was a PR merged?
 * Did CI fail on the merge commit? Were the failed jobs lint /
 * integration / unit?
 *
 * Kept narrow on purpose: producers (the gh-poller in PR-2 + GitHub
 * webhook bridge in a future PR) construct this from `gh pr view` /
 * `gh run list` JSON output — no full GitHub API surface needed.
 */
export interface PostMergeInput {
  /** GitHub PR number. */
  prNumber: number;
  /**
   * Merge SHA. Empty string when only the EvidenceGateFailure event is
   * present (gate failed *before* a merge happened — pre-merge case).
   */
  sha: string;
  /** Branch the PR merged into. Typically 'develop' or 'main'. */
  branch: string;
  /** PR author login. Optional — informs attribution. */
  author?: string;
  /** PR title — used for synthesizer summary lines. */
  title?: string;
  /**
   * The job names that failed. May be empty (if only the PRMerged event
   * is present, with no follow-up CI failure observed yet).
   *
   * The classifier inspects job names against well-known patterns (lint,
   * typecheck, unit, integration, e2e, security, migration-linter) to
   * route to the right FailureMode.
   */
  failedJobs: string[];
  /**
   * Time elapsed (in seconds) between PR merge and the CI failure being
   * detected. Useful for severity heuristics — a failure that surfaces
   * within 5 minutes of merge is a high-severity DoD slip; one that
   * shows up 24 hours later is more likely a flake or upstream churn.
   *
   * Optional: undefined when only the PRMerged event is present.
   */
  postMergeAgeSec?: number;
  /**
   * The detection signal. Helps the synthesizer decide what to write.
   *
   *   - 'pr-merged-only'      — saw PRMerged; no CI failure (yet) /
   *                             producer fired this for completeness.
   *   - 'evidence-gate-failed' — required check failed pre-merge.
   *   - 'regression-after-merge' — CI red on a SHA that includes the
   *                                  merge commit.
   *   - 'post-merge-bug-report' — operator filed a bug post-merge.
   */
  signal:
    | 'pr-merged-only'
    | 'evidence-gate-failed'
    | 'regression-after-merge'
    | 'post-merge-bug-report';
  /**
   * Optional free-form description (e.g. the body of a PostMergeBugReport
   * event). When present the classifier may upgrade severity or add
   * secondary tags based on keywords.
   */
  description?: string;
}

/**
 * The minimal shape of an event-bus row consumed by the postmerge
 * subscriber. Re-declared here (mirrors `types.ts`) so this module
 * doesn't have to import the full mentor-event-bus type surface.
 */
export interface PostMergeEventRow {
  id: string;
  event_type:
    | 'PRMerged'
    | 'EvidenceGateFailure'
    | 'RegressionDetected'
    | 'PostMergeBugReport';
  schema_version: number;
  correlation_id: string | null;
  parent_event_id: string | null;
  emitted_at: string;
  hostname: string;
  process_name: string | null;
  payload_json: string;
  validation_failed: 0 | 1;
  ingest_offset: number;
}
