/**
 * RUN-MODES — plan-only and test-only run modes (migration 0038).
 *
 * Every prompt is a CAIA run. The run mode controls how far down the
 * pipeline a run goes; this module is the single source of truth for
 * the `RunMode` enum, the per-mode pipeline gates, and the per-mode
 * capability-allowlist transformations.
 *
 * Three modes:
 *
 *   'full' (default)
 *     PO + BA + EA + Validator + Test-Design + Task Manager +
 *     worker-assignment (Coding Agent + Fix-It). The mode every
 *     prompt has had since pipeline-stages.ts was canonicalised.
 *
 *   'plan-only'
 *     Pipeline runs through `bucket_placed` / `ready_for_pickup`.
 *     ReadyPoolConsumer skips worker assignment for these prompts —
 *     stories stay in the bucket as "ready-for-review". Output is the
 *     WorkGraph + per-story `architecturalInstructions[]` + per-story
 *     estimated tokens + estimated total cost. No file writes, no PRs.
 *     Useful for "what would CAIA do with this prompt" preview.
 *
 *   'test-only'
 *     Full pipeline runs, but the per-run capability allowlist has
 *     deploy/publish/push-main capabilities stripped before the
 *     capsule (D1, migration 0037) is frozen. Code is written and
 *     tested by the worker; nothing is deployed or published. Once
 *     the Track 1 capability broker lands, the broker enforces this
 *     allowlist; until then it's plumbed through the capsule and
 *     the Coding Agent honours it on best-effort.
 *
 * Cross-references:
 *   - D1 / Context Capsule (migration 0037, PR #207): the capsule is
 *     where the run-mode-restricted allowlist gets hashed in. Drift
 *     on the allowlist between freeze and worker-pickup is detectable.
 *   - Track 1 / Capability Broker (in flight): the broker reads the
 *     capsule's allowlist and enforces it at every tool call.
 *   - Track 1 / Spend-cap (HARDEN-011, PR #206): orthogonal —
 *     spend-cap halts a run independent of run mode.
 *
 * @owner orchestrator (Phase 2 / run-modes track)
 */

/** Canonical list of run modes. Index 0 is the default. */
export const RUN_MODES = ['full', 'plan-only', 'test-only'] as const;

export type RunMode = (typeof RUN_MODES)[number];

/** The default run mode applied when the caller doesn't specify one. */
export const DEFAULT_RUN_MODE: RunMode = 'full';

/**
 * Type guard. Returns true if `value` is a known run mode. Used at
 * the API boundary to validate request bodies and CLI args before
 * persisting to the prompt row.
 */
export function isRunMode(value: unknown): value is RunMode {
  return typeof value === 'string' && (RUN_MODES as readonly string[]).includes(value);
}

/**
 * Capabilities that a 'test-only' run cannot use. The capsule freezer
 * removes these from the allowlist before computing the capsule hash;
 * the worker (when the broker is online) refuses tool calls for any
 * stripped capability. This list is intentionally explicit rather than
 * computed: stripping a capability that downstream code didn't expect
 * to be optional should be a code-review-visible change.
 *
 * Mirrors the four explicitly named in the operator mandate:
 *   - git_push_main
 *   - cloudflare_pages_deploy_*  (any capability whose id starts
 *     with this prefix; matched in `restrictAllowlistForMode`)
 *   - supabase_migration_apply
 *   - npm_publish
 */
export const TEST_ONLY_STRIPPED_CAPABILITIES: ReadonlySet<string> = new Set([
  'git_push_main',
  'supabase_migration_apply',
  'npm_publish',
]);

/**
 * Capability-id prefixes that test-only also strips (any capability
 * starting with one of these). Used to capture families like
 * cloudflare_pages_deploy_preview and cloudflare_pages_deploy_prod
 * without listing each variant.
 */
export const TEST_ONLY_STRIPPED_PREFIXES: ReadonlyArray<string> = [
  'cloudflare_pages_deploy_',
];

/**
 * Returns true if `capabilityId` should be stripped under 'test-only'.
 * Hot-path-friendly — this is called per capability per capsule freeze.
 */
export function isTestOnlyStripped(capabilityId: string): boolean {
  if (TEST_ONLY_STRIPPED_CAPABILITIES.has(capabilityId)) return true;
  for (const prefix of TEST_ONLY_STRIPPED_PREFIXES) {
    if (capabilityId.startsWith(prefix)) return true;
  }
  return false;
}

/**
 * Apply the run-mode-specific transformation to a capability allowlist.
 * For 'full' and 'plan-only' the allowlist is returned unchanged
 * (plan-only never reaches the worker, so allowlist enforcement never
 * fires). For 'test-only' the deploy/publish/push capabilities are
 * removed.
 *
 * Returns a new array — does not mutate `allowlist`. The order of the
 * remaining capabilities is preserved (caller may rely on this for
 * stable capsule hashes when only the allowlist changes).
 */
export function restrictAllowlistForMode(
  mode: RunMode,
  allowlist: readonly string[],
): string[] {
  if (mode === 'test-only') {
    return allowlist.filter((id) => !isTestOnlyStripped(id));
  }
  return [...allowlist];
}

/**
 * Should the orchestrator skip worker assignment for stories belonging
 * to a run in this mode? True for 'plan-only'; false for 'full' and
 * 'test-only'. Hot-path-called from ReadyPoolConsumer.pump() — a tiny
 * function so callers can inline-comment the gate.
 */
export function shouldSkipWorkerAssignment(mode: RunMode): boolean {
  return mode === 'plan-only';
}

/**
 * Should this run write code at all? True for 'full' and 'test-only';
 * false for 'plan-only'. Provided as a complement to
 * shouldSkipWorkerAssignment so call-sites that read more naturally
 * with a positive verb ("should write code") have a name that matches.
 */
export function shouldWriteCode(mode: RunMode): boolean {
  return mode !== 'plan-only';
}

/**
 * Should this run be allowed to deploy / publish / push to main?
 * True only for 'full'. Both 'plan-only' (doesn't write code) and
 * 'test-only' (writes code but capability-restricted) return false.
 */
export function shouldAllowDeployment(mode: RunMode): boolean {
  return mode === 'full';
}

// ─── Cost / token estimation ─────────────────────────────────────────────────

/**
 * Per-agent rough-cut token estimate. Used for plan-only's "estimated
 * cost" output. These numbers are deliberately approximate; they exist
 * to give the user a "is this $0.50 or $50" signal before they commit
 * to a full run. Refine as we collect actual telemetry from
 * `executor_runs.tokens_in/out`.
 *
 * Numbers are per-agent-per-story, summed over all stories in the
 * WorkGraph to get the total. The Coding Agent + Fix-It contributions
 * are excluded from plan-only's estimate (since they don't run); they
 * are included in the test-only and full estimates.
 */
export const PER_AGENT_TOKEN_ESTIMATE = {
  po: { input: 4_000, output: 2_000 },
  ba: { input: 6_000, output: 3_000 },
  ea: { input: 8_000, output: 4_000 },
  validator: { input: 5_000, output: 1_500 },
  testDesign: { input: 4_000, output: 2_500 },
  taskManager: { input: 1_000, output: 500 },
  coding: { input: 12_000, output: 6_000 },
  fixIt: { input: 6_000, output: 3_000 },
} as const;

/**
 * Anthropic Sonnet-class pricing (USD per 1M tokens). Approximate; used
 * only for plan-only's cost preview. The dashboard shows this with a
 * "± rough estimate" caveat.
 */
export const SONNET_PRICING = {
  inputUsdPer1M: 3.0,
  outputUsdPer1M: 15.0,
} as const;

export interface PerStoryCostEstimate {
  storyId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedUsd: number;
}

export interface RunCostEstimate {
  mode: RunMode;
  totalStories: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  estimatedUsd: number;
  perStory: PerStoryCostEstimate[];
}

/**
 * Compute a rough cost estimate for a run with `storyCount` stories
 * in the given mode. The per-story estimate is uniform (the same
 * agent loadout runs against each story); callers that have richer
 * per-story info can supply their own perStory array.
 */
export function estimateRunCost(mode: RunMode, storyIds: readonly string[]): RunCostEstimate {
  const includesCoding = mode !== 'plan-only';
  const perStoryInput =
    PER_AGENT_TOKEN_ESTIMATE.po.input +
    PER_AGENT_TOKEN_ESTIMATE.ba.input +
    PER_AGENT_TOKEN_ESTIMATE.ea.input +
    PER_AGENT_TOKEN_ESTIMATE.validator.input +
    PER_AGENT_TOKEN_ESTIMATE.testDesign.input +
    PER_AGENT_TOKEN_ESTIMATE.taskManager.input +
    (includesCoding ? PER_AGENT_TOKEN_ESTIMATE.coding.input : 0);

  const perStoryOutput =
    PER_AGENT_TOKEN_ESTIMATE.po.output +
    PER_AGENT_TOKEN_ESTIMATE.ba.output +
    PER_AGENT_TOKEN_ESTIMATE.ea.output +
    PER_AGENT_TOKEN_ESTIMATE.validator.output +
    PER_AGENT_TOKEN_ESTIMATE.testDesign.output +
    PER_AGENT_TOKEN_ESTIMATE.taskManager.output +
    (includesCoding ? PER_AGENT_TOKEN_ESTIMATE.coding.output : 0);

  const perStoryUsd =
    (perStoryInput / 1_000_000) * SONNET_PRICING.inputUsdPer1M +
    (perStoryOutput / 1_000_000) * SONNET_PRICING.outputUsdPer1M;

  const perStory = storyIds.map((storyId) => ({
    storyId,
    totalInputTokens: perStoryInput,
    totalOutputTokens: perStoryOutput,
    estimatedUsd: round4(perStoryUsd),
  }));

  return {
    mode,
    totalStories: storyIds.length,
    totalInputTokens: perStoryInput * storyIds.length,
    totalOutputTokens: perStoryOutput * storyIds.length,
    estimatedUsd: round4(perStoryUsd * storyIds.length),
    perStory,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
