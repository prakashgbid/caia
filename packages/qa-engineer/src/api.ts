/**
 * `@caia/qa-engineer/api` — public entry point.
 *
 * `validateInProduction(ticketId, productionUrl, config)` is the single
 * function this package's consumers call. It:
 *
 *   1. Resolves the e2e specs to run via `config.specStrategy`.
 *   2. Spawns Playwright against the production URL via
 *      `config.playwright` (a {@link PlaywrightAdapter}).
 *   3. On Playwright pass: hands off to `config.outcomeSteward` to
 *      cross-check the deployed package's declared SLIs.
 *   4. On any required Playwright failure OR a red SLI cell:
 *      builds a {@link RollbackRecommendation} payload.
 *   5. Drives the canonical FSM transition:
 *        `deployed -> verified`     (pass)
 *        `deployed -> verify-failed` (fail)
 *
 * State-machine integration is identical in shape to
 * `@caia/per-story-tester`: idempotent transitions, graceful handling
 * of ProjectNotFoundError + InvalidTransitionError, structured outcome
 * for the orchestrator.
 */

import {
  InvalidTransitionError,
  ProjectNotFoundError,
} from '@caia/state-machine';
import type {
  ProjectState,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';

import { buildRunPlan } from './agent.js';
import type {
  OutcomeStewardCheck,
  PlaywrightRunResult,
  PlaywrightSpecResult,
  ProductionTarget,
  RollbackRecommendation,
  RollbackSeverity,
  StateTransitionOutcome,
  ValidateInProductionConfig,
  ValidateInProductionResult,
} from './types.js';
import { FAIL_STATE, PASS_STATE, SOURCE_STATE } from './types.js';

const SOURCE: ProjectState = SOURCE_STATE;
const PASS: ProjectState = PASS_STATE;
const FAIL: ProjectState = FAIL_STATE;

/**
 * Validate a deployed ticket in production. See module-level doc.
 *
 * The `target` argument fully identifies the unit of work; `config`
 * carries injected adapters + the state machine. Returns a structured
 * verdict — never throws on test failure (failures are returned as
 * `status: 'failed'` with a rollback recommendation).
 */
export async function validateInProduction(
  target: ProductionTarget,
  config: ValidateInProductionConfig,
): Promise<ValidateInProductionResult> {
  const clock = config.clock ?? ((): Date => new Date());
  const startedAtIso = clock().toISOString();

  // 1. Resolve specs (test-author-emitted → production-pointing).
  const resolution = await config.specStrategy.resolveSpecs(target);

  // 2. Spawn Playwright.
  const playPlan = buildRunPlan(target, {
    specFiles: resolution.specFiles,
    ...(config.mode ? { mode: config.mode } : {}),
    ...(config.playwrightTimeoutMs ? { timeoutMs: config.playwrightTimeoutMs } : {}),
  });
  const playwright = await config.playwright.run(playPlan);

  let outcomeSteward: OutcomeStewardCheck | undefined;
  let rollback: RollbackRecommendation | undefined;
  const playwrightPassed = playwright.requiredFailures === 0 && playwright.status === 'passed';

  // 3. SLI cross-check, only when Playwright is green.
  if (playwrightPassed && config.metricBackend) {
    outcomeSteward = await config.outcomeSteward.check(target, {
      backend: config.metricBackend,
      windowHours: config.windowHours ?? 1,
      site: config.site ?? 'caia-production',
      now: clock,
    });
  }

  // 4. Decide overall verdict + build rollback payload.
  const overall = decideVerdict(playwright, outcomeSteward);
  if (overall === 'failed') {
    rollback = buildRollbackRecommendation(target, playwright, outcomeSteward);
  }

  // 5. Drive FSM.
  const finishedAtIso = clock().toISOString();

  const result: ValidateInProductionResult = {
    ticketId: target.ticketId,
    projectId: target.projectId,
    productionUrl: target.productionUrl,
    packageName: target.packageName,
    status: overall,
    playwright,
    startedAtIso,
    finishedAtIso,
  };
  if (outcomeSteward !== undefined) {
    (result as { outcomeSteward?: OutcomeStewardCheck }).outcomeSteward = outcomeSteward;
  }
  if (rollback !== undefined) {
    (result as { rollbackRecommendation?: RollbackRecommendation }).rollbackRecommendation = rollback;
  }

  if (!config.skipStateMachine && config.stateMachine) {
    const transition = await driveTransition(target, overall, config);
    if (transition) {
      (result as { transition?: StateTransitionOutcome }).transition = transition;
    }
  }

  return result;
}

// ─── Verdict ─────────────────────────────────────────────────────────────────

export function decideVerdict(
  playwright: PlaywrightRunResult,
  outcomeSteward: OutcomeStewardCheck | undefined,
): 'passed' | 'failed' {
  if (playwright.status !== 'passed' || playwright.requiredFailures > 0) {
    return 'failed';
  }
  if (!outcomeSteward) return 'passed';
  switch (outcomeSteward.verdict) {
    case 'all-green':
      return 'passed';
    case 'no-metric-declared':
      // Per outcome-steward spec §4.3: undeclared SLI ⇒ graceful pass
      // (we can't fail a package for not declaring metrics).
      return 'passed';
    case 'no-metric-store':
      // Metric store absent: same — graceful pass; we never block on
      // infra we don't own.
      return 'passed';
    case 'degraded':
      // Backend reachable but flaky: pass with a yellow note. The
      // hourly steward will re-attest next cycle.
      return 'passed';
    case 'red':
      return 'failed';
    case 'mixed':
      // Any red cell ⇒ failed; yellow-only ⇒ pass.
      return outcomeSteward.summary.red > 0 ? 'failed' : 'passed';
  }
}

// ─── Rollback recommendation ────────────────────────────────────────────────

export function buildRollbackRecommendation(
  target: ProductionTarget,
  playwright: PlaywrightRunResult,
  outcomeSteward: OutcomeStewardCheck | undefined,
): RollbackRecommendation {
  const failedSpecs = playwright.specs
    .filter((s) => s.required && (s.status === 'failed' || s.status === 'errored'))
    .map((s) => s.specId);
  const redCells = outcomeSteward
    ? outcomeSteward.relevantCells
        .filter((c) => c.status === 'red')
        .map((c) => `${c.packageName}::${c.solutionId}::${c.sliMetric}`)
    : [];

  const severity = decideSeverity(playwright, outcomeSteward);
  const reasonParts: string[] = [];
  if (failedSpecs.length > 0) {
    reasonParts.push(`${failedSpecs.length} required Playwright spec(s) failed in production`);
  }
  if (redCells.length > 0) {
    reasonParts.push(`${redCells.length} SLI cell(s) red`);
  }
  if (playwright.status === 'errored') {
    reasonParts.push(`Playwright run errored (timeout or runner crash)`);
  }
  const reason = reasonParts.join('; ') || 'production validation failed';

  const steps = buildSteps(severity, target, failedSpecs, redCells);

  return {
    severity,
    reason,
    evidence: {
      failedSpecs,
      redCells,
    },
    steps,
  };
}

export function decideSeverity(
  playwright: PlaywrightRunResult,
  outcomeSteward: OutcomeStewardCheck | undefined,
): RollbackSeverity {
  // Urgent if required smoke tests are failing — user-visible breakage.
  if (playwright.requiredFailures > 0) return 'urgent';
  // Urgent if any SLI cell is red — declared promise violated.
  if (outcomeSteward && outcomeSteward.summary.red > 0) return 'urgent';
  // Errored Playwright (timeout / runner crash) is "wait" — re-run.
  if (playwright.status === 'errored') return 'wait';
  return 'recommended';
}

function buildSteps(
  severity: RollbackSeverity,
  target: ProductionTarget,
  failedSpecs: ReadonlyArray<string>,
  redCells: ReadonlyArray<string>,
): ReadonlyArray<string> {
  const steps: string[] = [];
  if (severity === 'wait') {
    steps.push('Re-run @caia/qa-engineer after Playwright timeout — the run errored, not failed.');
    steps.push(`Check production logs at ${target.productionUrl} for runner-side issues.`);
    return steps;
  }
  if (failedSpecs.length > 0) {
    steps.push(`Open the Playwright report and inspect the failed spec(s): ${failedSpecs.slice(0, 5).join(', ')}${failedSpecs.length > 5 ? ` (+${failedSpecs.length - 5} more)` : ''}.`);
  }
  if (redCells.length > 0) {
    steps.push(`Inspect Grafana / Prometheus for the red SLI(s): ${redCells.slice(0, 5).join(', ')}${redCells.length > 5 ? ` (+${redCells.length - 5} more)` : ''}.`);
  }
  steps.push(`Trigger @caia/devops-runtime rollback for ticket ${target.ticketId} (revert to previous deployment of ${target.packageName}).`);
  steps.push(`Move ticket ${target.ticketId} back to coding-in-progress via state-machine transition verify-failed -> coding-in-progress with FSE patch loop.`);
  if (severity === 'urgent') {
    steps.push('Notify on-call: user-visible production breakage confirmed.');
  }
  return steps;
}

// ─── State-machine driver ───────────────────────────────────────────────────

async function driveTransition(
  target: ProductionTarget,
  status: 'passed' | 'failed',
  config: ValidateInProductionConfig,
): Promise<StateTransitionOutcome | undefined> {
  const sm = config.stateMachine;
  if (!sm) return undefined;
  const toState: ProjectState = status === 'passed' ? PASS : FAIL;

  let project;
  try {
    project = await sm.getProject(target.projectId);
  } catch (err) {
    return buildTransitionError(target, SOURCE, toState, `getProject failed: ${describe(err)}`);
  }
  if (!project) {
    return buildTransitionError(target, SOURCE, toState, `project ${target.projectId} not found`);
  }

  const fromState = project.status;
  const triggeredBy: TriggeredBy = config.triggeredBy ?? {
    kind: 'agent',
    id: '@caia/qa-engineer',
  };

  try {
    const transitionResult: TransitionResult = await sm.transition(
      target.projectId,
      toState,
      {
        reason:
          status === 'passed'
            ? `production validation passed for ${target.ticketId}`
            : `production validation failed for ${target.ticketId}`,
        triggeredBy,
        payload: {
          ticketId: target.ticketId,
          productionUrl: target.productionUrl,
          packageName: target.packageName,
          verdict: status,
        },
      },
    );
    return {
      attempted: true,
      fromState,
      toState,
      applied: transitionResult.applied,
      reason: transitionResult.applied ? 'transition-applied' : 'idempotent-no-op',
      transitionResult,
    };
  } catch (err) {
    const reason =
      err instanceof InvalidTransitionError
        ? `invalid-transition: ${err.message}`
        : err instanceof ProjectNotFoundError
          ? `project-not-found: ${err.message}`
          : `transition-error: ${describe(err)}`;
    return {
      attempted: true,
      fromState,
      toState,
      applied: false,
      reason,
      transitionResult: {
        applied: false,
        projectId: target.projectId,
        fromState,
        toState,
        newVersion: project.version,
        historyId: null,
        payloadHash: '',
        retries: 0,
      },
    };
  }
}

function buildTransitionError(
  target: ProductionTarget,
  fromState: ProjectState,
  toState: ProjectState,
  reason: string,
): StateTransitionOutcome {
  return {
    attempted: true,
    fromState,
    toState,
    applied: false,
    reason,
    transitionResult: {
      applied: false,
      projectId: target.projectId,
      fromState,
      toState,
      newVersion: 0,
      historyId: null,
      payloadHash: '',
      retries: 0,
    },
  };
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Re-exports for callers that want a tighter import surface ──────────────

export { SOURCE_STATE, PASS_STATE, FAIL_STATE } from './types.js';

// Helper for unit testing pure pieces.
export function summarisePlaywrightForLog(
  result: PlaywrightRunResult,
): string {
  const parts: string[] = [];
  parts.push(`status=${result.status}`);
  parts.push(`specs=${result.specs.length}`);
  parts.push(`requiredFailures=${result.requiredFailures}`);
  parts.push(`durationMs=${result.totalDurationMs}`);
  return parts.join(' ');
}

export function failedSpecIds(
  specs: ReadonlyArray<PlaywrightSpecResult>,
): ReadonlyArray<string> {
  return specs
    .filter((s) => s.status === 'failed' || s.status === 'errored')
    .map((s) => s.specId);
}
