/** Shared types for the pipeline-pulse health-check system. */

export type PulseOutcome = 'PASSING' | 'DEGRADED' | 'CRITICAL' | 'AUTO-HEALED';

export interface CheckResult {
  name: string;
  stage: 'infra' | 'executor' | 'pipeline';
  passed: boolean;
  message: string;
  durationMs: number;
}

export interface InvariantResult {
  name: string;
  passed: boolean;
  message: string;
  expected?: string;
  actual?: string;
}

export interface HealResult {
  action: string;
  triggeredBy: string;
  success: boolean;
  idempotent: boolean;
  message: string;
  durationMs: number;
}

export interface CanaryResult {
  taskId: string | null;
  dispatchedAt: string | null;
  completedAt: string | null;
  elapsedMs: number | null;
  passed: boolean;
  message: string;
}

export interface PulseResult {
  runId: string;
  ranAt: string;
  outcome: PulseOutcome;
  durationMs: number;
  canary: CanaryResult;
  invariants: InvariantResult[];
  checks: CheckResult[];
  heals: HealResult[];
}

/** Interface each check must implement */
export interface Check {
  name: string;
  stage: CheckResult['stage'];
  /** Runs with its own internal timeout guard */
  run(ctx: PulseContext): Promise<CheckResult>;
}

/** Interface each heal action must implement */
export interface HealAction {
  name: string;
  /** Checks that trigger this heal */
  triggeredByChecks: string[];
  /** Must be idempotent — safe to call even if already healed */
  run(ctx: PulseContext): Promise<HealResult>;
}

export interface PulseContext {
  apiBase: string;
  dbUrl: string;
  conductorDir: string;
  runId: string;
  noHeal: boolean;
}
