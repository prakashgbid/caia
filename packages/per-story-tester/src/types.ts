/**
 * Public type surface for @caia/per-story-tester (Stage 14).
 */

import type { TestCase, TestCaseLayer, TestCaseCategory } from '@chiefaia/ticket-template';
import type {
  ProjectState,
  StateMachine,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';

export type TestCaseRunStatus = 'passed' | 'failed' | 'skipped' | 'flaky' | 'errored';

export type RunnerKind = 'vitest' | 'playwright' | 'axe' | 'lighthouse';

export interface TestCaseResult {
  caseId: string;
  testName: string;
  file: string;
  line?: number;
  layer: TestCaseLayer;
  category: TestCaseCategory;
  runner: RunnerKind;
  status: TestCaseRunStatus;
  durationMs: number;
  errorMessage?: string;
  errorStack?: string;
  flakeRetries?: number;
  axeViolations?: AxeViolation[];
  lighthouseAudit?: LighthouseAuditSummary;
}

export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | 'unknown';
  description: string;
  helpUrl: string;
  nodes: number;
}

export interface LighthouseAuditSummary {
  performanceScore: number;
  accessibilityScore: number;
  bestPracticesScore: number;
  seoScore: number;
  lcpMs?: number;
  cls?: number;
  tbtMs?: number;
  budgetFailed: boolean;
  failedAudits: string[];
}

export interface LayerSummary {
  layer: TestCaseLayer | 'lighthouse';
  totalCases: number;
  passed: number;
  failed: number;
  skipped: number;
  errored: number;
  flaky: number;
  durationMs: number;
}

export interface PrReviewComment {
  header: string;
  body: string;
  requestChanges: boolean;
  threads: Array<{
    file: string;
    line?: number;
    caseId: string;
    testName: string;
    message: string;
  }>;
}

export interface StateTransitionOutcome {
  attempted: true;
  toState: ProjectState;
  fromState: ProjectState;
  applied: boolean;
  reason: string;
  transitionResult: TransitionResult;
}

export interface TestResults {
  ticketId: string;
  projectId: string;
  status: 'passed' | 'failed';
  perCase: TestCaseResult[];
  layers: LayerSummary[];
  summary: {
    totalCases: number;
    passed: number;
    failed: number;
    skipped: number;
    errored: number;
    flaky: number;
    durationMs: number;
    requiredFailures: number;
  };
  prComment?: PrReviewComment;
  transition?: StateTransitionOutcome;
  startedAtIso: string;
  finishedAtIso: string;
}

export interface TicketStore {
  loadTicket(ticketId: string): Promise<LoadedTicket>;
}

export interface LoadedTicket {
  ticketId: string;
  projectId: string;
  repoPath: string;
  testCases: TestCase[];
  baseUrl?: string;
  performanceBudget?: PerformanceBudget;
  unitTestPaths?: string[];
  integrationTestPaths?: string[];
  behaviorTestPath?: string;
}

export interface PerformanceBudget {
  lighthouseDeltaPct: number;
  performanceScoreFloor?: number;
  lcpMs?: number;
  cls?: number;
  tbtMs?: number;
}

export interface RunPlan {
  runner: RunnerKind;
  cases: TestCase[];
  cwd: string;
  vitestFiles?: string[];
  playwrightFiles?: string[];
  url?: string;
  performanceBudget?: PerformanceBudget;
  env?: Record<string, string>;
}

export interface RunnerRawOutput {
  runner: RunnerKind;
  exitCode: number;
  stdout: string;
  stderr: string;
  jsonReport?: unknown;
  jsonReportPath?: string;
  durationMs: number;
  plan: RunPlan;
}

export interface RunAdapter {
  run(plan: RunPlan): Promise<RunnerRawOutput>;
}

export interface RunStoryTestsConfig {
  store: TicketStore;
  adapter: RunAdapter;
  stateMachine?: StateMachine;
  triggeredBy?: TriggeredBy;
  skipStateMachine?: boolean;
  clock?: () => Date;
  resolveTestFile?: (testCase: TestCase, loaded: LoadedTicket) => string | undefined;
  resolveBaseUrl?: (loaded: LoadedTicket) => string;
}
