/**
 * @caia/per-story-tester — Stage 14 of the canonical pipeline.
 *
 * Public surface re-exports.
 */

export { runStoryTests, buildPrComment } from './api.js';

export {
  executePlans,
  planRuns,
  createSpawnAdapter,
} from './runner.js';
export type { SpawnAdapterOptions } from './runner.js';

export {
  parseRunnerOutput,
  parseVitestJson,
  parsePlaywrightJson,
  parseAxeViolations,
  parseLighthouseReport,
  synthesiseRunnerError,
} from './result-parser.js';

export type {
  AxeViolation,
  LayerSummary,
  LighthouseAuditSummary,
  LoadedTicket,
  PerformanceBudget,
  PrReviewComment,
  RunAdapter,
  RunPlan,
  RunStoryTestsConfig,
  RunnerKind,
  RunnerRawOutput,
  StateTransitionOutcome,
  TestCaseResult,
  TestCaseRunStatus,
  TestResults,
  TicketStore,
} from './types.js';
