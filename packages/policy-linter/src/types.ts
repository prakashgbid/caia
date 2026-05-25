/**
 * @caia/policy-linter — public type surface.
 *
 * Types describe the dispatch -> policy -> verdict contract that the engine,
 * CLI, dispatch-hook, and CI action all consume. Sourced from
 * `research/ai_first_continuous_discipline_2026.md` §Layer 1 (lines 566-614).
 *
 * The contract is intentionally narrow: every policy is a pure function from
 * a `DispatchContext` to a `PolicyVerdict`. The engine has no opinion on what
 * policies do; it only enforces the parallel-run + aggregation contract.
 */

/**
 * Three-mode discipline (spec line 612).
 *
 *  - `hard-fail` — blocks dispatch with non-zero exit (CI fails the PR).
 *  - `soft-fail` — surfaces a deduplicated INBOX entry tagged
 *    `[policy-violation]` and proceeds.
 *  - `advisory` — logs to `~/.caia/policy-log/YYYY-MM-DD.jsonl`.
 */
export type PolicyMode = 'hard-fail' | 'soft-fail' | 'advisory';

/**
 * Discriminated-union outcome of a single policy check.
 *
 * Note: `ok: true` carries no mode/reason; `ok: false` always carries both.
 * `suggestedFix` is optional remediation copy the engine can surface to the
 * operator INBOX or PR comment.
 */
export type PolicyVerdict =
  | { ok: true }
  | {
      ok: false;
      mode: PolicyMode;
      reason: string;
      suggestedFix?: string;
      evidence?: ReadonlyArray<PolicyEvidence>;
    };

/**
 * One match snippet supporting a policy violation. Carries enough context for
 * the operator to find and fix the line in the brief.
 */
export interface PolicyEvidence {
  /** Source identifier — e.g. brief path or `dispatchContext.briefMd`. */
  source: string;
  /** 1-based line number where the violation matched, if known. */
  line?: number;
  /** Literal text of the matched snippet (trimmed to ~200 chars). */
  snippet: string;
}

/**
 * The brief-level intent classification (spec §Layer 2 routing heuristics,
 * lines 631-637). Drives policy applicability — e.g. `ea-agent-gate` only
 * fires when intent is in {research, spec, build-architecturally-significant}.
 */
export type DispatchIntent =
  | 'research'
  | 'spec'
  | 'build'
  | 'review'
  | 'ops'
  | 'meta';

/**
 * Concrete input passed to every `Policy.check()` call.
 *
 * Fields mirror the spec's `DispatchContext` (lines 571-580) plus a few
 * additions the user's directive required: `eaPlanSubmissionId` (evidence the
 * plan was submitted), `dodStewards` (the 4-steward green snapshot),
 * `openPrCount` (true-zero check), and `prBody` (admin-merge phrasing check).
 *
 * All fields are required at runtime so policies can defensively assume
 * presence. The CLI and dispatch-hook are responsible for populating them
 * from the brief / repo state / `gh` calls.
 */
export interface DispatchContext {
  /** Caller agent identifier — used in event payloads. */
  callerAgentId: string;
  /** Full markdown body of the task brief. */
  briefMd: string;
  /** Tool list the dispatch will be granted. */
  toolList: ReadonlyArray<string>;
  /** Estimated tokens; always 0 under P2 but useful for diagnostics. */
  estimatedTokens: number;
  /** Estimated paid-API cost in USD; should be 0 under ADR-001/P1. */
  estimatedCost: number;
  /** Repositories this dispatch will write to. */
  targetRepos: ReadonlyArray<string>;
  /** Brief-level intent classification. */
  intent: DispatchIntent;
  /** Optional: PR body text if this is a PR-time check. */
  prBody?: string;
  /** Optional: PR diff text (unified format) if available. */
  prDiff?: string;
  /** Optional: number of open PRs on the caller repo (ADR-050 true-zero). */
  openPrCount?: number;
  /** Optional: env var keys the dispatch will see (for ANTHROPIC_API_KEY etc). */
  envKeys?: ReadonlyArray<string>;
  /** Optional: evidence the plan was submitted to EA Architect. */
  eaPlanSubmissionId?: string;
  /** Optional: 4-steward DoD snapshot. */
  dodStewards?: DodStewardSnapshot;
  /** Optional: brief metadata (frontmatter or operator annotations). */
  metadata?: Readonly<Record<string, unknown>>;
}

/**
 * Snapshot of the four Real-DoD stewards' last reported colour (PR #567 /
 * `@caia/state-machine` Real-DoD; PR #566 / `@caia/activation-steward`).
 *
 * The four canonical stewards (from `packages/` directory):
 *   - activation-steward — Layer 2 of Real-DoD (OpenTelemetry runtime check).
 *   - ea-doc-steward — EA Repository drift detector.
 *   - outcome-steward — outcome-vs-promise auditor.
 *   - plan-defender — PR #568 dialogue-based plan defender.
 *
 * `green` = passed last run. `red` = failed. `unknown` = never reported or
 * stale (>24h). The `dod-stewards-green` policy fails the dispatch unless all
 * four are `green` (or the dispatch is bootstrap-exempt).
 */
export interface DodStewardSnapshot {
  activationSteward: StewardStatus;
  eaDocSteward: StewardStatus;
  outcomeSteward: StewardStatus;
  planDefender: StewardStatus;
  /** Optional ISO timestamp of the snapshot. */
  snapshotAt?: string;
}

export type StewardStatus = 'green' | 'red' | 'unknown';

/**
 * A policy is a stable identifier + description + an async check function.
 *
 * The engine runs all registered policies in parallel via
 * `Promise.allSettled`. A throwing policy is treated as a `hard-fail` with
 * the thrown reason; this is intentional — a broken policy is itself a
 * framework bug (spec line 608: "If any policy fails to fire, that's a P0
 * framework bug").
 */
export interface Policy {
  /** Stable kebab-case id — used in event payloads + INBOX entries. */
  readonly id: string;
  /** Human-readable description shown in `--help` and CI reports. */
  readonly description: string;
  /** Default mode if the policy fires. */
  readonly defaultMode: PolicyMode;
  /** Run the check. Must be pure and async. */
  check(ctx: DispatchContext): Promise<PolicyVerdict>;
}

/**
 * Aggregated outcome of running every registered policy against one context.
 */
export interface PolicyReport {
  /** ISO timestamp of when the report was generated. */
  generatedAt: string;
  /** Caller agent identifier (echoed from context). */
  callerAgentId: string;
  /** Per-policy results. */
  results: ReadonlyArray<PolicyResult>;
  /** Highest-severity outcome — drives exit code + gating decision. */
  worstOutcome: 'pass' | 'advisory' | 'soft-fail' | 'hard-fail';
  /** Convenience: hardFails.length + softFails.length + advisories.length. */
  violationCount: number;
}

/**
 * One row in the report — pairs a policy with its verdict + mode.
 */
export interface PolicyResult {
  policyId: string;
  description: string;
  verdict: PolicyVerdict;
  /** Resolved mode — defaultMode unless the policy returned a different mode. */
  effectiveMode: PolicyMode | 'pass';
  /** Wall-clock ms the check took. */
  durationMs: number;
}
