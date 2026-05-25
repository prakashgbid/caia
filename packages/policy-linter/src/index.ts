/**
 * @caia/policy-linter — public surface.
 *
 * Layer 1 of the AI-First Continuous-Discipline framework
 * (`research/ai_first_continuous_discipline_2026.md`).
 *
 * Encodes locked operator feedback memories as code-as-policy gates.
 * Deterministic backstop for the EA Architect (Layer 2, mutating). This is
 * the validating layer: it can refuse a dispatch but not transform it.
 *
 * Public exports:
 *
 *   - Types: `DispatchContext`, `Policy`, `PolicyVerdict`, `PolicyMode`,
 *     `PolicyReport`, `PolicyResult`, `DodStewardSnapshot`, etc.
 *   - Engine: `PolicyEngine` with `run(ctx, options)` -> `PolicyReport`.
 *   - Events: `POLICY_CHECK_COMPLETED`, `POLICY_VIOLATION_DETECTED`.
 *   - Report helpers: `buildReport`, `buildResult`, `toJson`, `toMarkdown`,
 *     `toLine`, `exitCodeFor`.
 *   - Default policy bundle: `defaultPolicies` (the 7 operator-locked rules).
 *   - Each policy is also exported individually under `./policies/<id>`.
 *
 * Consumers:
 *   - `caia-policy-lint` CLI (`./cli`).
 *   - `runPolicyPreflight` dispatch-hook (`./dispatch-hook`).
 *   - `renderGithubActionsStep` (`./ci-action`).
 */

export type {
  DispatchContext,
  DispatchIntent,
  DodStewardSnapshot,
  Policy,
  PolicyEvidence,
  PolicyMode,
  PolicyReport,
  PolicyResult,
  PolicyVerdict,
  StewardStatus
} from './types.js';

export {
  PolicyEngine,
  POLICY_CHECK_COMPLETED,
  POLICY_VIOLATION_DETECTED,
  type PolicyCheckCompletedEvent,
  type PolicyViolationDetectedEvent,
  type RunPoliciesOptions
} from './policy-engine.js';

export {
  buildReport,
  buildResult,
  toJson,
  toLine,
  toMarkdown,
  exitCodeFor
} from './report.js';

// Individual policies — each also re-exports its detector helpers for tests.
export { noCalendarTimeEstimatesPolicy } from './policies/no-calendar-time-estimates.js';
export { autoMergePrsPolicy } from './policies/auto-merge-prs.js';
export { subscriptionOnlyBuildPolicy } from './policies/subscription-only-build.js';
export { eaAgentGatePolicy } from './policies/ea-agent-gate.js';
export { dodStewardsGreenPolicy } from './policies/dod-stewards-green.js';
export { shadcnNotMuiPolicy } from './policies/shadcn-not-mui.js';
export { noIdleResearchPolicy } from './policies/no-idle-research.js';

import { noCalendarTimeEstimatesPolicy } from './policies/no-calendar-time-estimates.js';
import { autoMergePrsPolicy } from './policies/auto-merge-prs.js';
import { subscriptionOnlyBuildPolicy } from './policies/subscription-only-build.js';
import { eaAgentGatePolicy } from './policies/ea-agent-gate.js';
import { dodStewardsGreenPolicy } from './policies/dod-stewards-green.js';
import { shadcnNotMuiPolicy } from './policies/shadcn-not-mui.js';
import { noIdleResearchPolicy } from './policies/no-idle-research.js';
import type { Policy } from './types.js';

/**
 * Canonical 7-policy bundle matching the operator's directive.
 *
 * Order matches the directive text:
 *   no-calendar-time-estimates, auto-merge-prs, subscription-only-build,
 *   ea-agent-gate, dod-stewards-green, shadcn-not-mui, no-idle-research.
 */
export const defaultPolicies: ReadonlyArray<Policy> = Object.freeze([
  noCalendarTimeEstimatesPolicy,
  autoMergePrsPolicy,
  subscriptionOnlyBuildPolicy,
  eaAgentGatePolicy,
  dodStewardsGreenPolicy,
  shadcnNotMuiPolicy,
  noIdleResearchPolicy
]);
