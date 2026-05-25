/**
 * @caia/policy-linter — parallel policy runner.
 *
 * The engine has one job: run every registered policy against one
 * `DispatchContext` and aggregate the results into a `PolicyReport`. Policies
 * run via `Promise.allSettled` so a single throwing policy can't take the
 * whole batch down (per spec line 608: a broken policy is a P0 framework bug
 * but should still produce a verdict).
 *
 * Optionally emits two event types via an `EventBus` (`@chiefaia/events`):
 *
 *   - `policy.check.completed` — once per policy, includes verdict.
 *   - `policy.violation.detected` — once per non-`ok` verdict.
 *
 * The event names mirror the spec's proposed taxonomy additions
 * (lines 44, 290, 720-725).
 */

import type { EventBus } from '@chiefaia/events';

import { buildReport, buildResult } from './report.js';
import type {
  DispatchContext,
  Policy,
  PolicyReport,
  PolicyResult,
  PolicyVerdict
} from './types.js';

export const POLICY_CHECK_COMPLETED = 'policy.check.completed';
export const POLICY_VIOLATION_DETECTED = 'policy.violation.detected';

export interface RunPoliciesOptions {
  /** Optional event bus to emit `policy.*` events on. */
  eventBus?: EventBus;
  /** Override clock for deterministic timestamps in tests. */
  now?: () => Date;
}

export interface PolicyCheckCompletedEvent {
  policyId: string;
  callerAgentId: string;
  verdict: PolicyVerdict;
  durationMs: number;
}

export interface PolicyViolationDetectedEvent {
  policyId: string;
  callerAgentId: string;
  mode: 'hard-fail' | 'soft-fail' | 'advisory';
  reason: string;
  suggestedFix?: string;
}

export class PolicyEngine {
  private readonly policies: ReadonlyArray<Policy>;

  constructor(policies: ReadonlyArray<Policy>) {
    if (policies.length === 0) {
      throw new Error(
        '[policy-linter] PolicyEngine requires at least one policy; got zero.'
      );
    }
    const ids = new Set<string>();
    for (const p of policies) {
      if (ids.has(p.id)) {
        throw new Error(
          `[policy-linter] Duplicate policy id "${p.id}". Each policy must have a unique id.`
        );
      }
      ids.add(p.id);
    }
    this.policies = policies;
  }

  /** Convenience: list registered policy ids in registration order. */
  listPolicyIds(): ReadonlyArray<string> {
    return this.policies.map((p) => p.id);
  }

  /**
   * Run every policy against `ctx` in parallel and return the aggregated
   * report. Never throws — a policy that throws is treated as a hard-fail
   * with the error message as `reason`.
   */
  async run(
    ctx: DispatchContext,
    options: RunPoliciesOptions = {}
  ): Promise<PolicyReport> {
    const now = options.now ?? ((): Date => new Date());
    const results = await Promise.all(
      this.policies.map((p) => this.runOne(p, ctx, options))
    );
    return buildReport(ctx.callerAgentId, results, now);
  }

  private async runOne(
    policy: Policy,
    ctx: DispatchContext,
    options: RunPoliciesOptions
  ): Promise<PolicyResult> {
    const start = Date.now();
    let verdict: PolicyVerdict;
    try {
      verdict = await policy.check(ctx);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      verdict = {
        ok: false,
        mode: 'hard-fail',
        reason: `Policy threw: ${message}`,
        suggestedFix:
          'Fix the policy implementation. A throwing policy is a P0 framework bug (spec line 608).'
      };
    }
    const durationMs = Date.now() - start;

    // Emit events if a bus is wired up.
    if (options.eventBus) {
      const completedPayload: PolicyCheckCompletedEvent = {
        policyId: policy.id,
        callerAgentId: ctx.callerAgentId,
        verdict,
        durationMs
      };
      // Fire-and-forget; do not await to keep the parallel run snappy.
      void options.eventBus.emit(POLICY_CHECK_COMPLETED, completedPayload);
      if (!verdict.ok) {
        const violationPayload: PolicyViolationDetectedEvent = {
          policyId: policy.id,
          callerAgentId: ctx.callerAgentId,
          mode: verdict.mode,
          reason: verdict.reason
        };
        if (verdict.suggestedFix !== undefined) {
          violationPayload.suggestedFix = verdict.suggestedFix;
        }
        void options.eventBus.emit(POLICY_VIOLATION_DETECTED, violationPayload);
      }
    }

    return buildResult(policy, verdict, durationMs);
  }
}
