/**
 * @caia/reuse-check-gate — enforcement layer L2 of the reuse-first guardrail wave.
 *
 * Why: @caia/ea-architect's `submitPlan` is published from a separate repo
 * (we cannot fork it for a single field). This adapter layers the
 * `reuseSearchResults` field requirement on top of every CAIA-internal
 * caller. Plans of type `implementation` with no reuseSearchResults are
 * refused before they reach the critic.
 *
 * See: ADR-065 (caia-ea/decisions), AGENTS.md > Reuse-first.
 */

/** One package considered (or rejected) by the planning agent. */
export interface ReuseSearchResult {
  /** Workspace package name, e.g. "@caia/ui" or "@chiefaia/http-client". */
  packageName: string;
  /** Did the planner actually inspect the package? */
  considered: boolean;
  /** Selected for reuse vs. rejected after inspection. */
  decision: "selected" | "rejected";
  /** Human-readable rationale. Required — empty string is treated as missing. */
  reason: string;
}

/** Plan-type discriminator. Lifted from the @caia/ea-architect type surface. */
export type PlanType =
  | "research"
  | "spec"
  | "implementation"
  | "architecture-change"
  | "process-change";

/** Reuse-aware plan submission. Mirrors @caia/ea-architect's PlanSubmission + the new field. */
export interface PlanWithReuse {
  planMarkdown: string;
  planType: PlanType;
  callerAgentId: string;
  submittedBy: string;
  affectedComponents?: string[];
  /**
   * REQUIRED for `implementation` plans. The list of @caia/* / @chiefaia/*
   * packages the planning agent considered, with a per-package decision and
   * rationale. An empty array is treated as "no search performed".
   */
  reuseSearchResults: ReuseSearchResult[];
  submissionId?: string;
}

/** Structural type for the @caia/ea-architect agent surface. */
export interface EaArchitectLike {
  submitPlan: (input: unknown) => Promise<unknown>;
}

/** Error thrown when a plan fails the reuse-search gate. */
export class ReuseSearchGateError extends Error {
  readonly code: "MISSING_REUSE_SEARCH" | "EMPTY_REUSE_SEARCH" | "MALFORMED_REUSE_RESULT";
  readonly planType: PlanType;
  readonly submissionId?: string;

  constructor(
    code: ReuseSearchGateError["code"],
    message: string,
    planType: PlanType,
    submissionId?: string
  ) {
    super(message);
    this.name = "ReuseSearchGateError";
    this.code = code;
    this.planType = planType;
    if (submissionId !== undefined) this.submissionId = submissionId;
  }
}

/**
 * Plan types that mandate a reuse-search. Research, spec, architecture-change,
 * and process-change plans don't ship code, so the search is optional but
 * recommended.
 */
const PLAN_TYPES_REQUIRING_REUSE_SEARCH: ReadonlySet<PlanType> = new Set([
  "implementation",
]);

/**
 * Refuse a plan that doesn't include a reuse-search. Throws ReuseSearchGateError
 * on failure; returns silently on pass. Idempotent.
 */
export function assertReuseSearchPresent(plan: PlanWithReuse): void {
  if (!PLAN_TYPES_REQUIRING_REUSE_SEARCH.has(plan.planType)) {
    return; // research/spec/architecture-change/process-change plans bypass
  }
  if (!Array.isArray(plan.reuseSearchResults)) {
    throw new ReuseSearchGateError(
      "MISSING_REUSE_SEARCH",
      `Plan of type "${plan.planType}" must include a reuseSearchResults array. ` +
        `See AGENTS.md > Reuse-first (mandatory).`,
      plan.planType,
      plan.submissionId
    );
  }
  if (plan.reuseSearchResults.length === 0) {
    throw new ReuseSearchGateError(
      "EMPTY_REUSE_SEARCH",
      `Plan of type "${plan.planType}" has an empty reuseSearchResults array. ` +
        `Search @caia/* and @chiefaia/* for prior art before submitting. ` +
        `Use the @caia/reuse-searcher package or the caia-reuse-search-mcp tool.`,
      plan.planType,
      plan.submissionId
    );
  }
  for (const r of plan.reuseSearchResults) {
    if (!r || typeof r.packageName !== "string" || r.packageName.length === 0) {
      throw new ReuseSearchGateError(
        "MALFORMED_REUSE_RESULT",
        `reuseSearchResults entry is missing packageName.`,
        plan.planType,
        plan.submissionId
      );
    }
    if (r.decision !== "selected" && r.decision !== "rejected") {
      throw new ReuseSearchGateError(
        "MALFORMED_REUSE_RESULT",
        `reuseSearchResults["${r.packageName}"] has invalid decision "${String(r.decision)}". ` +
          `Must be "selected" or "rejected".`,
        plan.planType,
        plan.submissionId
      );
    }
    if (typeof r.reason !== "string" || r.reason.trim().length === 0) {
      throw new ReuseSearchGateError(
        "MALFORMED_REUSE_RESULT",
        `reuseSearchResults["${r.packageName}"] is missing a non-empty reason.`,
        plan.planType,
        plan.submissionId
      );
    }
  }
}

/**
 * Submit a plan through the reuse-search gate. Calls the EA agent only if
 * the gate passes. The EA agent argument is structurally typed so this
 * package doesn't depend on @caia/ea-architect at install-time.
 */
export async function submitPlanWithReuseGate<T extends EaArchitectLike>(
  plan: PlanWithReuse,
  ea: T
): Promise<unknown> {
  assertReuseSearchPresent(plan);
  return ea.submitPlan(plan);
}

/**
 * Did the planner actually select at least one workspace package for reuse?
 * Useful for downstream metrics: plans that "considered + rejected everything"
 * may indicate the searcher's index is missing entries.
 */
export function hasSelectedReusePackage(plan: PlanWithReuse): boolean {
  if (!Array.isArray(plan.reuseSearchResults)) return false;
  return plan.reuseSearchResults.some((r) => r.decision === "selected");
}
