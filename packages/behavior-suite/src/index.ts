export type {
  RegionKey,
  LayoutContract,
  URLContract,
  JourneyStep,
  TestStatus,
  TestResult,
  CoverageRollup,
  BehaviorSuiteMeta,
} from './types';

export { REGION_LOCATORS } from './types';

export {
  BehaviorSuite,
  checkLayoutContract,
  checkUrlContract,
  checkJourneyCompletes,
  checkA11y,
  checkStateInvariant,
  findRegion,
} from './expectations';

export type { RunScope, RunnerResult, SuiteRunResult } from './runner';
export { resolveScope, runBehaviorSuite } from './runner';

export type {
  ConductorConfig,
  BehaviorTestUpsertPayload,
  BehaviorRunPayload,
  BehaviorFailurePayload,
} from './conductor';
export { ConductorBehaviorClient, defaultConductorClient } from './conductor';
