/**
 * @chiefaia/ticket-template — SectionContract + StoryScope (ACR-001)
 *
 * The Agent Section Contract Registry's primitive types. Each agent that
 * writes into a Phase-1 ticket — PO, BA, EA, Test-Design — declares a
 * `SectionContract` listing the sections it will populate, with descriptions
 * and per-scope rubrics. The Story Validator consolidates contracts at
 * runtime via `composeTemplate(scope)` (ACR-002) into a scope-aware
 * `ComposedTemplate` and uses that as its rubric.
 *
 * Goal: every story is self-sufficient, stateless, context-less.
 * Test-Design + coding agents get everything from the ticket alone.
 *
 * Design notes:
 *
 *  - `StoryScope` mirrors the SAFe / Jira hierarchy (initiative → epic →
 *    module → story → task → subtask). The DB column on `stories.story_scope`
 *    indexes which scope a row sits at; legacy rows backfill to 'story'.
 *  - `SectionContract.appliesTo` is the per-scope opt-in. The composed
 *    template for a given scope is the union of contracts whose
 *    `appliesTo` includes that scope.
 *  - `SectionSpec.scopeOverrides` lets a single section relax/tighten its
 *    rubric per scope (e.g. initiative scope demands more strategic depth
 *    than a subtask).
 *  - All types here are framework-agnostic; the registry + composition
 *    algorithm live in `@chiefaia/agent-contract-registry` (ACR-002).
 */

import type { ZodTypeAny } from 'zod';

// ─── StoryScope ─────────────────────────────────────────────────────────────

/**
 * The six canonical scopes a Phase-1 ticket can occupy. Aligned to SAFe /
 * Jira hierarchy with one CAIA-specific nuance: `module` represents a DDD
 * bounded context / capability cluster (we deliberately skip SAFe's
 * `Capability` level because `module` covers it for our needs).
 *
 * Semantics:
 *  - `initiative` — strategic bet, multi-quarter, portfolio level.
 *  - `epic`       — ART-level grouping, multi-PI.
 *  - `module`     — bounded context / capability cluster.
 *  - `story`      — sprintable user-value unit (THE canonical ticket).
 *  - `task`       — self-contained unit of work, one-coder/one-bucket.
 *  - `subtask`    — smallest atomic step (rare).
 */
export const STORY_SCOPES = [
  'initiative',
  'epic',
  'module',
  'story',
  'task',
  'subtask',
] as const;

export type StoryScope = (typeof STORY_SCOPES)[number];

/**
 * Stable ordinal — useful for sorting + scope-comparison checks
 * ("section X applies to scopes >= module"). Lower number = higher level.
 */
export const STORY_SCOPE_ORDER: Record<StoryScope, number> = {
  initiative: 0,
  epic: 1,
  module: 2,
  story: 3,
  task: 4,
  subtask: 5,
};

/** Type guard — useful at the DB-load boundary where we accept arbitrary text. */
export function isStoryScope(value: unknown): value is StoryScope {
  return typeof value === 'string' && (STORY_SCOPES as readonly string[]).includes(value);
}

/** Default scope assigned to legacy stories that pre-date the `story_scope` column. */
export const DEFAULT_STORY_SCOPE: StoryScope = 'story';

// ─── AgentRole ──────────────────────────────────────────────────────────────

/**
 * The four agent roles that own ticket sections in Phase 1. The pipeline
 * order — PO → BA → EA → Test-Design — drives both the ticket-writing
 * sequence and the conflict-resolution tie-breaker in `composeTemplate`.
 */
export const AGENT_ROLES = ['po', 'ba', 'ea', 'test-design'] as const;
export type AgentRole = (typeof AGENT_ROLES)[number];

/**
 * Pipeline order of agent contributions. `composeTemplate` uses this as the
 * tie-breaker when two contracts claim the same section — the earlier
 * agent wins (PO < BA < EA < Test-Design).
 */
export const AGENT_ORDER: Record<AgentRole, number> = {
  po: 0,
  ba: 1,
  ea: 2,
  'test-design': 3,
};

// ─── Severity (mirrors validation-rubric.ts) ────────────────────────────────

/**
 * Severity of a per-section finding. Matches `RubricSeverity` from
 * `validation-rubric.ts` — kept as a parallel type here so the contract
 * package doesn't take a circular dependency on the rubric module.
 *
 *  - `hard`    → blocks pipeline; story cannot advance.
 *  - `soft`    → blocks first attempt only; warning on attempt 2+.
 *  - `warning` → never blocks; surfaced on the dashboard.
 */
export type ContractSeverity = 'hard' | 'soft' | 'warning';

// ─── SectionRubric ──────────────────────────────────────────────────────────

/**
 * Per-section validation expectations. The Validator's six-step pipeline
 * runs these as deterministic checks (steps 2-3) plus an LLM relevance
 * judge (step 4) seeded by `relevancePromptSeed`.
 *
 * All numeric thresholds default to "no minimum" if absent.
 */
export interface SectionRubric {
  /** Sum of words across all string fields in the section. */
  minWords?: number;
  /** Minimum array length when the section's data shape is itself an array. */
  minItems?: number;
  /**
   * Map of sub-field path (relative to the section) → min item count.
   * Example: `{ 'routes': 1, 'errorContract': 0 }` for the api section.
   */
  minItemsPerSubField?: Readonly<Record<string, number>>;
  /** Sub-field paths that must exist and be non-empty (string or array). */
  requiredSubFields?: readonly string[];
  /**
   * Regex patterns (source form, JS-compatible). The section's concatenated
   * text must contain at least one match per entry.
   */
  requiredEntityRefs?: ReadonlyArray<{
    /** Identifier surfaced in failure reports. */
    label: string;
    /** Regex source. */
    pattern: string;
    /** Optional JS regex flags (e.g. `i`). */
    flags?: string;
  }>;
  /**
   * Phrases that, if present (word-boundary, case-insensitive), trigger a
   * `forbidden_snippet` finding. Layered on top of the universal forbidden
   * list from `validation-rubric.ts`.
   */
  forbiddenSnippets?: readonly string[];
  /**
   * Prompt seed for the LLM relevance judge. The Validator builds the full
   * relevance prompt via `buildContentRelevancePrompt(...)` from
   * `validation-rubric.ts`, using this as the section-purpose body.
   */
  relevancePromptSeed?: string;
  /** Severity if the deterministic rules fail. */
  severityOnFail: ContractSeverity;
  /** Operator-facing fix hint surfaced to the owning agent on failure. */
  fixHint: string;
}

// ─── SectionExample ─────────────────────────────────────────────────────────

/**
 * Two examples per section — a "good" and a "bad" — teach the LLM judge
 * what "complete" looks like. Used as few-shot fragments in relevance
 * prompts and surfaced on the dashboard `/contracts` page.
 */
export interface SectionExample {
  /** A canonical "complete" populated section. */
  good: unknown;
  /** A canonical "incomplete" / "off-topic" populated section. */
  bad: unknown;
  /**
   * Short rationale for why `bad` is bad — fed into the LLM judge's
   * few-shot prompt and shown to operators on the dashboard.
   */
  badRationale: string;
}

// ─── SectionSpec ────────────────────────────────────────────────────────────

/**
 * One section in an agent's contract. The validator iterates the union of
 * specs from the composed template per story.
 */
export interface SectionSpec {
  /**
   * Dotted path identifying the section within the ticket payload, e.g.
   * `'scope'`, `'agentSections.architecture'`, `'taxonomy.effort'`,
   * `'architecturalInstructions'` (when ARCH-006 lands).
   *
   * Used as the `section` key in `validation-rubric.ts` findings and as the
   * key in `EA_OWNED_PREFIXES` ownership classification.
   */
  name: string;
  /** Operator-facing description: what this section IS. */
  description: string;
  /** Operator-facing rationale: why downstream agents need this section. */
  purpose: string;
  /**
   * Structural validation. The Validator parses the section payload through
   * this Zod schema before any rubric checks run.
   */
  dataShape: ZodTypeAny;
  /**
   * Hard-required vs optional within the contract's `appliesTo` scopes.
   * Override per-scope via `scopeOverrides`.
   */
  required: boolean;
  /** Per-section validation rubric (deterministic + LLM). */
  rubric: SectionRubric;
  /**
   * Other section names (in the same composed template) that must be present
   * and valid before this section is evaluated. Composition warns if a
   * declared dependency is missing in the composed template for a scope.
   */
  dependencies?: readonly string[];
  /**
   * Two examples — the LLM judge uses these as few-shot fragments and the
   * dashboard renders them as "what good/bad looks like".
   */
  examples: readonly SectionExample[];
  /**
   * Optional per-scope overrides — relax `required` or shrink/grow rubric
   * thresholds at specific scopes (e.g. initiative scope demands more
   * strategic depth from `scope.summary`; subtask demands less).
   *
   * Override semantics:
   *  - `required` (if set) replaces the base `required`.
   *  - Rubric fields (if set) shallow-merge over the base rubric — i.e.
   *    each set field replaces the base value.
   */
  scopeOverrides?: Partial<
    Record<StoryScope, Partial<SectionRubric> & { required?: boolean }>
  >;
}

// ─── SectionContract ────────────────────────────────────────────────────────

/**
 * The top-level contract object an agent registers with the Agent Section
 * Contract Registry. One agent may register multiple contracts (e.g. one
 * per scope-cluster) but the canonical pattern is a single contract per
 * agent role.
 */
export interface SectionContract {
  /** Owning agent — drives ownership classification + pipeline ordering. */
  ownerAgent: AgentRole;
  /**
   * Stable identifier — used for de-dup, conflict messages, and dashboard
   * navigation. Format suggestion: `<agent>-agent.v<major>` (e.g.
   * `'po-agent.v1'`).
   */
  contractId: string;
  /**
   * Human-readable semver-ish version. Bumped on any rubric/spec change.
   * Surfaced in the `signature` of the ComposedTemplate so drift is
   * detectable.
   */
  version: string;
  /** Story scopes this contract is required for. */
  appliesTo: readonly StoryScope[];
  /** Sections this contract owns. */
  sections: readonly SectionSpec[];
}

// ─── ComposedTemplate (consumed by Validator) ───────────────────────────────

/**
 * One section as it appears in the runtime-composed template, after applying
 * scope overrides and resolving any conflicts via the agent-pipeline order.
 */
export interface ComposedSectionEntry {
  spec: SectionSpec;
  /** Base `rubric` shallow-merged with the matching `scopeOverrides[scope]`. */
  effectiveRubric: SectionRubric;
  /** Base `required` overridden by `scopeOverrides[scope].required` if set. */
  effectiveRequired: boolean;
  /** Owning agent — copied from the contract for fast lookup. */
  ownerAgent: AgentRole;
  /** Source contract ID — for failure-attribution and dashboard rendering. */
  contractId: string;
}

/**
 * The validator's runtime input. Built by `composeTemplate(scope)` from the
 * registry; cached per scope per process; invalidated on registry mutation.
 */
export interface ComposedTemplate {
  scope: StoryScope;
  /**
   * Section name → composed entry. `Map` preserves insertion order, which
   * matches agent-pipeline order (PO sections first, then BA, then EA, then
   * Test-Design).
   */
  sections: ReadonlyMap<string, ComposedSectionEntry>;
  /**
   * Stable signature — a hash of the normalized composed spec. Two
   * compositions with the same signature produce identical validator
   * behaviour. Used for cache keying + drift detection.
   */
  signature: string;
  /**
   * Composition warnings (non-fatal):
   *  - Two contracts claim the same section name (later one ignored).
   *  - A section's `dependencies` references an absent section.
   */
  warnings: readonly string[];
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Compute the effective rubric + required for a section at a given scope.
 * Pure; used internally by `composeTemplate` and exposed for tests.
 */
export function applyScopeOverride(
  spec: SectionSpec,
  scope: StoryScope,
): { effectiveRubric: SectionRubric; effectiveRequired: boolean } {
  const override = spec.scopeOverrides?.[scope];
  if (!override) {
    return { effectiveRubric: spec.rubric, effectiveRequired: spec.required };
  }
  const { required: overrideRequired, ...rubricOverride } = override;
  const effectiveRubric: SectionRubric = {
    ...spec.rubric,
    ...rubricOverride,
  };
  const effectiveRequired =
    overrideRequired !== undefined ? overrideRequired : spec.required;
  return { effectiveRubric, effectiveRequired };
}

/**
 * Compare two scopes by ordinal — useful for "section X applies to scopes
 * coarser than module".
 */
export function compareScopes(a: StoryScope, b: StoryScope): number {
  return STORY_SCOPE_ORDER[a] - STORY_SCOPE_ORDER[b];
}

/**
 * True iff `scope` is at least as coarse (higher in the hierarchy) as
 * `referenceScope`. `initiative` is the coarsest, `subtask` the finest.
 */
export function isScopeAtLeastAsCoarseAs(
  scope: StoryScope,
  referenceScope: StoryScope,
): boolean {
  return STORY_SCOPE_ORDER[scope] <= STORY_SCOPE_ORDER[referenceScope];
}
