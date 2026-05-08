/**
 * @chiefaia/code-reviewer — public surface.
 *
 * Sibling to `@chiefaia/critic` (security/regression/cost — BLOCKING) and
 * `@chiefaia/reviewer` (craftsmanship — ADVISORY-only). This package is
 * the BLOCKING reviewer for correctness/bugs/style/types/tests/naming/
 * comments, returning a binary verdict per `operator_decisions_2026-05-08.md`.
 *
 * Primary entrypoint: `runCodeReview({ prRef, repoPath, diff, context })`.
 */

export { CodeReviewerAgent, runCodeReview } from './agent.js';
export type { ReviewPRArgs, RunCodeReviewArgs } from './agent.js';

export {
  resolveConfig,
  expandHome,
  type CodeReviewerAgentConfig,
  type ResolvedCodeReviewerAgentConfig
} from './config.js';

export { defaultFsReader } from './fs-reader.js';
export { parseDiff, chunkHunk, walkHunk, type DiffLine } from './diff-parser.js';
export { loadConventions, parseConventionsMarkdown } from './conventions-loader.js';
export { mergeFindings, type MergeArgs, type MergeResult } from './merger.js';
export { findingId } from './finding-id.js';
export {
  createDefaultLlmReviewer,
  noopLlmReviewer,
  parseLlmOutput,
  buildPrompt,
  type DefaultLlmReviewerOptions
} from './llm-reasoner.js';

export type {
  CodeReview,
  CodeReviewFinding,
  CodeReviewDimensionId,
  CodeReviewSeverity,
  ConventionExcerpt,
  Detector,
  DiffHunk,
  ParsedDiff,
  FsReader,
  LlmReviewer,
  LlmReviewInput,
  LlmReviewOutput,
  ReviewSummary,
  ScanContext,
  Verdict
} from './types.js';

export {
  ALL_DIMENSIONS,
  DEFAULT_SEVERITY,
  SEVERITY_RANK,
  CRITIC_DENYLIST,
  ADVISORY_REVIEWER_DENYLIST
} from './types.js';
