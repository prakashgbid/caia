/**
 * @caia/policy-linter — pre-flight dispatch hook.
 *
 * Wraps any dispatch operation in a Layer-1 policy check. The intended
 * consumer is `@chiefaia/chain-runner/src/preflight.ts` (spec line 610), but
 * the hook is shaped as a generic "wrap any async function" helper so it
 * works equally for one-off scripts and ad-hoc dispatches.
 *
 * Usage:
 *
 *   const result = await runPolicyPreflight({
 *     ctx,
 *     dispatch: () => callSubAgent(...),
 *     onSoftFail: 'proceed',   // or 'block'
 *     eventBus
 *   });
 *
 *   if (!result.proceeded) {
 *     // Hard-fail (or soft-fail with onSoftFail: 'block').
 *     // Surface result.report.markdown to the operator INBOX.
 *   }
 *
 * The hook never throws; gate decisions are encoded in the returned
 * `PreflightResult`.
 */

import type { EventBus } from '@chiefaia/events';

import { defaultPolicies } from './index.js';
import { PolicyEngine } from './policy-engine.js';
import { toMarkdown } from './report.js';
import type {
  DispatchContext,
  Policy,
  PolicyReport
} from './types.js';

export interface PreflightInput<T> {
  /** Dispatch context — built by the caller before invoking the hook. */
  ctx: DispatchContext;
  /** The dispatch function — only invoked if the gate decides to proceed. */
  dispatch: () => Promise<T>;
  /**
   * Soft-fail handling.
   *
   * - `'proceed'` (default): the dispatch runs; INBOX-style entries are
   *   surfaced via the event bus / `markdown` field.
   * - `'block'`: the dispatch does NOT run; treat soft-fail as hard-fail.
   */
  onSoftFail?: 'proceed' | 'block';
  /** Optional event bus to publish `policy.violation.detected`. */
  eventBus?: EventBus;
  /** Policies to run; defaults to `defaultPolicies`. */
  policies?: ReadonlyArray<Policy>;
}

export interface PreflightResult<T> {
  /** True if the dispatch was actually invoked. */
  proceeded: boolean;
  /** Aggregated report from the engine. */
  report: PolicyReport;
  /** Markdown render of the report; convenient for INBOX entries. */
  markdown: string;
  /** The dispatch return value when proceeded; undefined otherwise. */
  result?: T;
  /** If proceeded was false, the human-readable gate reason. */
  blockReason?: string;
}

export async function runPolicyPreflight<T>(
  input: PreflightInput<T>
): Promise<PreflightResult<T>> {
  const policies = input.policies ?? defaultPolicies;
  const engine = new PolicyEngine(policies);
  const options = input.eventBus ? { eventBus: input.eventBus } : {};
  const report = await engine.run(input.ctx, options);
  const markdown = toMarkdown(report);

  const blockOnSoftFail = (input.onSoftFail ?? 'proceed') === 'block';
  const isHard = report.worstOutcome === 'hard-fail';
  const isSoft = report.worstOutcome === 'soft-fail';

  if (isHard || (isSoft && blockOnSoftFail)) {
    return {
      proceeded: false,
      report,
      markdown,
      blockReason: `Policy gate blocked dispatch — worst outcome: ${report.worstOutcome}, ${report.violationCount} violation(s).`
    };
  }
  // Either pass / advisory, or soft-fail with onSoftFail='proceed'.
  const result = await input.dispatch();
  return {
    proceeded: true,
    report,
    markdown,
    result
  };
}
