/**
 * Public API barrel for @chiefaia/apprentice-eval.
 */

export { ApprenticeEvalHarness } from './harness.js';
export type { HarnessReport } from './harness.js';
export type { ApprenticeEvalConfig, ResolvedApprenticeEvalConfig } from './config.js';
export { resolveConfig } from './config.js';
export { createOllamaClient } from './ollama-client.js';
export { createMlxFallback } from './mlx-fallback.js';
export { createClaudeJudge } from './judge.js';
export { aggregate } from './pairwise.js';
export { scoreOne } from './rubric-scorer.js';
export { applyDefaults, loadSuites, parseSuiteYaml } from './suite-loader.js';
export { readBaseline, writeBaseline } from './baseline-store.js';
export { readCorpusManifest } from './corpus-bridge.js';
export { runAbMode } from './ab-mode.js';
export type {
  AdapterSpec,
  AdapterWinrate,
  Assertion,
  AssertionResult,
  BaselineEntry,
  BaselineSnapshot,
  ClaudeJudge,
  CorpusManifestProjection,
  FsReader,
  FsWriter,
  GenerateRequest,
  GenerateResult,
  JudgeRecord,
  MlxFallback,
  OllamaClient,
  PairwiseOutcome,
  PairwiseResult,
  PromptSuite,
  RegressionFlag,
  RubricResult,
  RunConfigSnapshot,
  ScoreCardEntry,
  ScoreCards,
  SuiteDefaultTest,
  SuiteTestCase,
  WinrateReport
} from './types.js';
