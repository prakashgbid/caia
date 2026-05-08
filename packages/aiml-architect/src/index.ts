/**
 * @chiefaia/aiml-architect — public surface.
 */

export { AIMLArchitect } from './architect.js';

export {
  resolveConfig,
  expandHome,
  type AIMLArchitectConfig,
  type ResolvedAIMLArchitectConfig
} from './config.js';

export { defaultFsReader } from './fs-reader.js';
export { createDefaultMentorReader } from './mentor-bridge.js';
export { createDefaultCuratorReader } from './curator-bridge.js';
export { createDefaultAdapterRegistry } from './adapter-registry.js';

export { selectModel } from './select-model.js';
export { reviewPromptPattern } from './review-prompt-pattern.js';
export { ownEvalSuite } from './own-eval-suite.js';
export { coordinateApprenticeLoop } from './coordinate-apprentice-loop.js';
export {
  loadCanonicalSuite,
  SuiteLoadError,
  type CanonicalSuite,
  type CanonicalSuiteAssertion,
  type CanonicalSuiteTest
} from './eval-suite-loader.js';
export { generateConventionDoc } from './convention-doc-generator.js';

export {
  PROMPT_PATTERN_RULES,
  scoreFromFindings,
  type PromptPatternRule,
  type PromptCheckInput
} from './knowledge/prompt-patterns.js';
export {
  detectSignals,
  decideDspyCompile,
  type DspyCompileSignals,
  type DspyCompileVerdict
} from './knowledge/dspy-heuristics.js';
export {
  ASSERTION_TYPES,
  getAssertionRouting,
  type AssertionTypeDescriptor,
  type AssertionRouting
} from './knowledge/eval-methodology.js';
export {
  checkForgetting,
  type ForgettingViolation,
  type ForgettingCheckInput
} from './knowledge/forgetting-prevention.js';
export {
  decideModel,
  type DecideModelInput,
  type LocalModel,
  type RoutingRule
} from './knowledge/model-routing-decision-tree.js';

export type {
  AdapterRegistryEntry,
  AdapterRegistryReader,
  CoordinateDecision,
  CostSignal,
  CuratorFinding,
  CuratorReader,
  EvalIssue,
  EvalIssueKind,
  EvalSuite,
  FailureSignal,
  FallbackEntry,
  FindingSeverity,
  FsReader,
  Hardware,
  MentorEventRecord,
  MentorReader,
  ModelChoice,
  PromptFinding,
  PromptPatternKind,
  Provider,
  QualityBar,
  ReviewPromptPatternParams,
  ReviewResult,
  SelectModelParams,
  TrainingPlan
} from './types.js';
