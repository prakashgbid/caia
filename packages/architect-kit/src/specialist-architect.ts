/**
 * @caia/architect-kit — SpecialistArchitect interface.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §1.1.
 *
 * Every one of the 17 EA-phase architect packages exports a class that
 * implements this interface. The EA Dispatcher consumes the interface
 * polymorphically — it doesn't know or care which architect it's running,
 * only that it can call `systemPrompt()`, read `tools`, and `await run()`.
 *
 * Implementations should be:
 *  - Idempotent — calling `run()` twice with identical inputs returns
 *    identical outputs (modulo wall-clock time / non-deterministic LLM
 *    sampling, which the dispatcher handles via retry-with-corrected-prompt).
 *  - Stateless — no instance state survives between `run()` invocations.
 *    Architects are spawned per-ticket, so any cross-ticket cache lives
 *    outside the architect.
 *  - Pure prompt-builders — `systemPrompt()` returns the same string given
 *    no input, every time, per process. Test it by snapshotting.
 */

import type {
  ArchitectInput,
  ArchitectOutput,
  ToolDefinition,
} from './types.js';
import type { ArchitectSectionContract } from './architect-section-contract.js';

export interface SpecialistArchitect {
  /**
   * Stable architect identifier. Matches the package name minus the
   * `-architect` suffix (e.g. `'frontend'`, `'a11y'`, `'security'`).
   * The dispatcher uses this to key the dependency graph and the audit
   * row's `architect_name` column.
   */
  readonly name: string;

  /**
   * The disjoint-write contract: which JSONB paths this architect owns
   * under `tickets.architecture`, plus its wave/precedence metadata. The
   * dispatcher registers this with the global architect registry at boot.
   */
  readonly sectionContract: ArchitectSectionContract;

  /**
   * Pure function — returns the system prompt for the spawned Claude
   * subagent. Must be stable per process; tested via snapshot. Architects
   * that template their prompt (e.g. inject roster names or contract
   * versions) should do so deterministically.
   */
  systemPrompt(): string;

  /**
   * Architect-specific tools to expose to the spawned subagent. May be
   * empty. The dispatcher merges these with the global read-only tool
   * allowlist (Read, filtered Bash, …).
   */
  readonly tools: readonly ToolDefinition[];

  /**
   * The actual architect logic. Implementations typically:
   *   1. Compose a user-message prompt from the ArchitectInput.
   *   2. Call `claude-spawner` via the injected spawner adapter.
   *   3. Parse the response into `ArchitectOutput.architectureFields`.
   *   4. Compute confidence, spend, and risks.
   *
   * The dispatcher invokes this with a wall-clock timeout from
   * `input.budget.maxWallClockMs`. Implementations should respect that
   * deadline and return a `failed`/`partial` output rather than throw,
   * unless the failure is truly catastrophic.
   */
  run(input: ArchitectInput): Promise<ArchitectOutput>;
}
