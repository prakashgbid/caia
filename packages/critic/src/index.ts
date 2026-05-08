/**
 * @chiefaia/critic — public surface.
 *
 * Pre-commit adversarial review agent. See DESIGN.md for the design
 * rationale, taxonomy mapping, and integration pattern.
 */

export { CriticAgent, type ReviewPRArgs } from './agent.js';
export {
  resolveConfig,
  expandHome,
  type CriticAgentConfig,
  type ResolvedCriticAgentConfig
} from './config.js';

export { defaultFsReader } from './fs-reader.js';
export { parseDiff, chunkHunk, walkHunk, type DiffLine } from './diff-parser.js';
export {
  loadTaxonomy,
  parseTaxonomyMarkdown,
  nameToFailureModeId,
  flattenForMentor,
  CANONICAL_TAXONOMY
} from './taxonomy.js';
export { loadMemoryFiles, parseMemoryFile } from './memory-loader.js';
export { mergeFindings, type MergeArgs, type MergeResult } from './merger.js';
export {
  createDefaultLlmReasoner,
  noopLlmReasoner,
  parseLlmOutput,
  buildPrompt,
  type DefaultLlmReasonerOptions
} from './llm-reasoner.js';

export {
  ALL_DETECTORS,
  securityRegressionDetector,
  gitBranchHygieneDetector,
  prematureCompletionDetector,
  decisionClassifierDetector,
  reLitigationDetector,
  toolMisuseDetector,
  costOverrunDetector,
  recipeRotDetector,
  falseModestyDetector,
  incompletenessDetector
} from './detectors/index.js';

export type {
  AdversarialFinding,
  AdversarialReview,
  Detector,
  DiffHunk,
  ParsedDiff,
  FailureModeId,
  FsReader,
  LlmReasoner,
  LlmReasonInput,
  LlmReasonOutput,
  MemoryFileRef,
  ReviewSummary,
  ScanContext,
  Severity,
  TaxonomyEntry
} from './types.js';

export {
  ALL_FAILURE_MODES,
  DEFAULT_SEVERITY,
  SEVERITY_RANK
} from './types.js';
