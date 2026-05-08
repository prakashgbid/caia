/**
 * @chiefaia/reviewer — public surface.
 *
 * Craftsmanship-focused PR review agent — advisory-only. See DESIGN.md
 * for the design rationale, dimension mapping, and Critic differentiation.
 */

export { ReviewerAgent, type ReviewPRArgs } from './agent.js';
export {
  resolveConfig,
  expandHome,
  type ReviewerAgentConfig,
  type ResolvedReviewerAgentConfig
} from './config.js';

export { defaultFsReader } from './fs-reader.js';
export { parseDiff, chunkHunk, walkHunk, type DiffLine } from './diff-parser.js';
export { loadConventions, parseConventionsMarkdown } from './conventions-loader.js';
export { mergeFindings, type MergeArgs, type MergeResult } from './merger.js';
export {
  createDefaultLlmReviewer,
  noopLlmReviewer,
  parseLlmOutput,
  buildPrompt,
  type DefaultLlmReviewerOptions
} from './llm-reasoner.js';

export {
  ALL_DETECTORS,
  namingConventionDetector,
  functionLengthDetector,
  fileLengthDetector,
  commentDensityDetector,
  magicNumbersDetector,
  duplicateImportsDetector,
  deepNestingDetector,
  todoWithoutTicketDetector,
  consoleLoggingDetector,
  typeAnyDetector,
  isJsTsSrcPath,
  isTestPath,
  isDocsPath,
  isFixturePath
} from './detectors/index.js';

export type {
  CraftsmanshipFinding,
  CraftsmanshipReview,
  CraftsmanshipDimensionId,
  CraftsmanshipSeverity,
  ConventionExcerpt,
  Detector,
  DiffHunk,
  ParsedDiff,
  FsReader,
  LlmReviewer,
  LlmReviewInput,
  LlmReviewOutput,
  ReviewSummary,
  ScanContext
} from './types.js';

export {
  ALL_DIMENSIONS,
  DEFAULT_SEVERITY,
  SEVERITY_RANK,
  CRITIC_DENYLIST
} from './types.js';
