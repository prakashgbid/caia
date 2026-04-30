/**
 * Feature flag for the recursive decomposer (PO-DECOMP-004).
 *
 * P0 ships the engine library + per-scope prompts + judge pair, but
 * does NOT swap the orchestrator's PO Agent over to it yet. The
 * legacy `@chiefaia/decomposer.decomposeWithClaude` single-shot path
 * remains the production code path until the validation suite (PR 5)
 * has produced a parity report against real prompts.
 *
 * The flag's default is OFF in P0. P1's pipeline-integration PR
 * flips the default to ON after at least 30 production decompositions
 * show parity (or better) with the legacy path. This staged rollout
 * matches the proposal §5L recovery posture.
 *
 * Read order:
 *   1. Explicit `value` argument to `useRecursiveDecomposer({ value })`.
 *   2. Environment variable `PO_USE_RECURSIVE_DECOMPOSER` ('1' / 'true' on; otherwise off).
 *   3. Default off in P0.
 */

/**
 * Canonical pipeline-stage name for the new stage that the recursive
 * decomposer will own once the orchestrator routes through it.
 *
 * P0 declares the name (so consumers can reference a stable constant)
 * but does NOT register the stage in `PIPELINE_STAGE_ORDER` —
 * registering would require updating every existing pipeline-stage
 * test in lockstep. P1 adds the migration and updates the order.
 */
export const STAGE_PO_DECOMPOSING = 'po_decomposing';

/**
 * Environment-variable name whose value gates the new decomposer.
 */
export const PO_USE_RECURSIVE_DECOMPOSER_ENV = 'PO_USE_RECURSIVE_DECOMPOSER';

export interface UseRecursiveDecomposerOptions {
  /**
   * If supplied, overrides the env-var lookup. Use this to inject
   * the flag in tests or per-prompt overrides without polluting
   * the process environment.
   */
  value?: boolean;
  /**
   * Optional environment object (defaults to `process.env`). Tests
   * pass a stub.
   */
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}

/**
 * Decide whether to route a given decomposition through the new
 * recursive engine or the legacy single-shot path.
 *
 * In P0 this returns `false` unless explicitly opted in. Consumers
 * should call this from the PO Agent immediately before invoking
 * `decompose()` and branch:
 *
 * ```ts
 * if (useRecursiveDecomposer()) {
 *   // new engine path (P1 wiring)
 * } else {
 *   // existing decomposeWithClaude path
 * }
 * ```
 */
export function useRecursiveDecomposer(
  options: UseRecursiveDecomposerOptions = {},
): boolean {
  if (typeof options.value === 'boolean') return options.value;
  const env = options.env ?? process.env;
  const raw = env[PO_USE_RECURSIVE_DECOMPOSER_ENV];
  if (typeof raw !== 'string') return false;
  const normalised = raw.trim().toLowerCase();
  return normalised === '1' || normalised === 'true' || normalised === 'yes' || normalised === 'on';
}
