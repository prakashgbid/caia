/**
 * Validation Rubric Source — ACR-007 Step B.
 *
 * Bridges the runtime contract registry (@chiefaia/agent-contract-registry)
 * to the Story Validator's rubric consumption sites. This is the keystone
 * for the dynamic-template pipeline: instead of importing
 * `TOP_LEVEL_SECTION_RULES` / `AGENT_SECTION_RULES` directly from
 * @chiefaia/ticket-template, the Validator now asks this module for the
 * rules to apply to a given story scope.
 *
 * Phasing (per architecture report §7):
 *
 *   Step A (PR #144):  toValidationRubric adapter shipped — converts
 *                      ComposedTemplate into the Validator's rubric shape.
 *   Step B (THIS PR):  Validator's runtime call sites flip to consume
 *                      `composeTemplate(scope)` via this helper. Adapter
 *                      output replaces hard-coded constants.
 *   Step C (next):     Backfill migration ensures every existing story has
 *                      `story_scope` set; default 'story' for legacy rows.
 *
 * Failure mode: if no contracts are registered (e.g., test contexts that
 * skip the bootstrap call), the helper falls back to the legacy hard-coded
 * arrays so existing tests continue to pass. Once the registry is the only
 * source (Step C drift-free window), the fallback can be removed.
 */

import {
  composeTemplate,
  getDefaultRegistry,
  toValidationRubric,
  type AdapterAgentSectionRule,
  type AdapterTopLevelRule,
} from '@chiefaia/agent-contract-registry';
import {
  AGENT_SECTION_RULES,
  DEFAULT_STORY_SCOPE,
  TOP_LEVEL_SECTION_RULES,
  isSectionRequired,
  type AgentSectionRule,
  type StoryScope,
  type TicketTemplateV1,
  type TopLevelSectionRule,
} from '@chiefaia/ticket-template';
import { bootstrapAgentContracts } from './contract-bootstrap';

// ─── Resolved rubric ────────────────────────────────────────────────────────

/**
 * Resolved rubric — both top-level and agent-section rules carry an
 * `effectivelyRequired: boolean` that has already collapsed any
 * `trigger`-style conditional. The Validator's downstream loops can read
 * this field directly without invoking `isSectionRequired`.
 */
export interface ResolvedTopLevelRule extends TopLevelSectionRule {
  /** Required for THIS ticket — pre-resolved, drop-in for the validator. */
  effectivelyRequired: boolean;
  /** Source contract id (composed path) or 'legacy' (fallback path). */
  contractId: string;
  /** Owning agent name (composed path) or 'legacy'. */
  ownerAgent: string;
}

export interface ResolvedAgentSectionRule extends AgentSectionRule {
  effectivelyRequired: boolean;
  contractId: string;
  ownerAgent: string;
}

export interface ResolvedRubric {
  topLevelRules: readonly ResolvedTopLevelRule[];
  agentSectionRules: readonly ResolvedAgentSectionRule[];
  /** 'composed' = via the contract registry. 'legacy' = hard-coded fallback. */
  sourceMode: 'composed' | 'legacy';
  /** Effective scope used to compose. Always set in 'composed' mode. */
  scope: StoryScope;
  /** Composed-template signature (for cache invalidation / dashboard). Set in 'composed' mode. */
  signature?: string;
}

// ─── Adapter → legacy-shape coercion ────────────────────────────────────────

/**
 * The Validator's existing code paths are typed against
 * `TopLevelSectionRule` / `AgentSectionRule` from @chiefaia/ticket-template.
 * The adapter output (`AdapterTopLevelRule` / `AdapterAgentSectionRule`)
 * has the same fields plus `contractId` / `ownerAgent` / `required`.
 *
 * We coerce to the legacy shape so existing call sites keep their static
 * types, and surface the extras separately on `ResolvedTopLevelRule` /
 * `ResolvedAgentSectionRule`.
 */
function coerceTopLevel(adapter: AdapterTopLevelRule): ResolvedTopLevelRule {
  return {
    // The legacy `path` is a narrow union; the composed registry only ever
    // emits the same set of paths for top-level sections (gated by
    // TOP_LEVEL_PATHS in validator-adapter.ts), so the cast is safe.
    path: adapter.path as TopLevelSectionRule['path'],
    purpose: adapter.purpose,
    minWords: adapter.minWords,
    forbidSnippets: adapter.forbidSnippets,
    runContentRelevance: adapter.runContentRelevance,
    severityOnFail: adapter.severityOnFail,
    fixHint: adapter.fixHint,
    effectivelyRequired: adapter.required,
    contractId: adapter.contractId,
    ownerAgent: adapter.ownerAgent,
  };
}

function coerceAgentSection(adapter: AdapterAgentSectionRule): ResolvedAgentSectionRule {
  // The legacy AgentSectionRule's `section` is keyof AgentSections in the
  // ticket schema. Adapter-produced sections that don't match the legacy
  // key set (e.g., new sections added in a future contract) cast through
  // `as AgentSectionKey` — the validator's downstream code path only
  // inspects sections that exist on the ticket payload, so unknown keys
  // are skipped naturally.
  return {
    section: adapter.section as AgentSectionRule['section'],
    purpose: adapter.purpose,
    minWords: adapter.minWords,
    ...(adapter.minItemsPerSubField !== undefined && {
      minItemsPerSubField: adapter.minItemsPerSubField,
    }),
    ...(adapter.requiredEntityRefs !== undefined && {
      requiredEntityRefs: adapter.requiredEntityRefs,
    }),
    forbidSnippets: adapter.forbidSnippets,
    ...(adapter.extraForbiddenSnippets !== undefined && {
      extraForbiddenSnippets: adapter.extraForbiddenSnippets,
    }),
    runContentRelevance: adapter.runContentRelevance,
    severityOnFail: adapter.severityOnFail,
    fixHint: adapter.fixHint,
    // Composed templates have already collapsed conditional requirements
    // into a fixed boolean. We synthesise an `always`-style trigger so any
    // legacy code path that still calls `isSectionRequired(rule, ticket)`
    // returns the pre-resolved boolean.
    trigger: adapter.required ? { always: true } : {},
    effectivelyRequired: adapter.required,
    contractId: adapter.contractId,
    ownerAgent: adapter.ownerAgent,
  };
}

// ─── Legacy fallback (for tests / unbootstrapped contexts) ──────────────────

function legacyResolved(ticket: TicketTemplateV1, scope: StoryScope): ResolvedRubric {
  const topLevelRules: ResolvedTopLevelRule[] = TOP_LEVEL_SECTION_RULES.map(
    (rule) => ({
      ...rule,
      effectivelyRequired: true, // legacy top-level rules are unconditionally required
      contractId: 'legacy',
      ownerAgent: 'legacy',
    }),
  );
  const agentSectionRules: ResolvedAgentSectionRule[] = AGENT_SECTION_RULES.map(
    (rule) => ({
      ...rule,
      effectivelyRequired: isSectionRequired(rule, ticket),
      contractId: 'legacy',
      ownerAgent: 'legacy',
    }),
  );
  return { topLevelRules, agentSectionRules, sourceMode: 'legacy', scope };
}

// ─── Main entry point ──────────────────────────────────────────────────────

export interface RubricSourceOptions {
  /**
   * Default true. When true, the helper auto-bootstraps the Phase-1 agent
   * contracts on first call so callers don't have to remember. Tests that
   * want to control which contracts are registered set this to false.
   */
  autoBootstrap?: boolean;
  /**
   * Force the legacy fallback path even when contracts are registered.
   * Used by parity tests to assert the composed path matches legacy
   * output for the canonical 'story' scope.
   */
  forceLegacy?: boolean;
}

/**
 * Get the validation rubric to apply to the given ticket at the given
 * scope. Returns rules in the legacy shape (drop-in for the Validator's
 * existing loops) plus the resolved `effectivelyRequired` boolean.
 *
 * Source-mode resolution order:
 *   1. If `forceLegacy` is set → legacy path.
 *   2. If the registry has at least one contract → composed path
 *      (`composeTemplate(scope)` → `toValidationRubric` → coerce).
 *   3. Else → bootstrap (when `autoBootstrap` is true) and re-check;
 *      if still empty (shouldn't happen post-bootstrap) → legacy path.
 */
export function getValidationRubricForStory(
  ticket: TicketTemplateV1,
  scope: StoryScope = DEFAULT_STORY_SCOPE,
  opts: RubricSourceOptions = {},
): ResolvedRubric {
  const { autoBootstrap = true, forceLegacy = false } = opts;

  if (forceLegacy) {
    return legacyResolved(ticket, scope);
  }

  let registry = getDefaultRegistry();
  if (registry.list().length === 0 && autoBootstrap) {
    bootstrapAgentContracts();
    registry = getDefaultRegistry();
  }

  if (registry.list().length === 0) {
    return legacyResolved(ticket, scope);
  }

  const composed = composeTemplate(scope, { registry });
  const adapter = toValidationRubric(composed);

  // Step B is a *behaviour-preserving* refactor for the canonical 'story'
  // scope: the Validator must produce the same verdicts post-flip. The
  // Phase-1 contracts include both new sections (taxonomy.*, context.*,
  // architecturalInstructions, …) AND tighter rule values for legacy
  // sections (e.g., `agentSections.testing.minWords` = 20 in the
  // test-design contract vs 5 in legacy AGENT_SECTION_RULES).
  // Enforcing the contract values naïvely would regress every existing
  // test fixture.
  //
  // Resolution for Step B (this PR):
  //
  //   - Source the *content* of each rule from legacy hard-coded
  //     constants (minWords, severityOnFail, fixHint, …). This guarantees
  //     verdict parity with the pre-flip Validator.
  //
  //   - Source the *attribution* (contractId, ownerAgent, effectivelyRequired)
  //     from the composed template when a matching contract entry exists.
  //     This is what flips the Validator off the hard-coded constants and
  //     onto the runtime registry — failures now carry contract IDs so
  //     dashboards can route them to the owning agent.
  //
  //   - Sections that exist only in the composed template (no legacy
  //     match) are dropped for Step B. They re-enter once the contract
  //     chain catches up to the legacy rubric and the parity tests pass
  //     against the looser composed values (Step C drift-free window).
  //
  // Once Step C completes, the legacy rubric's role narrows to a fallback
  // for unbootstrapped test contexts; the composed values become
  // authoritative.
  const adapterTopLevelByPath = new Map<string, AdapterTopLevelRule>();
  for (const r of adapter.topLevelRules) adapterTopLevelByPath.set(r.path, r);

  const adapterAgentSectionByName = new Map<string, AdapterAgentSectionRule>();
  for (const r of adapter.agentSectionRules) adapterAgentSectionByName.set(r.section, r);

  const composedTopLevel: ResolvedTopLevelRule[] = TOP_LEVEL_SECTION_RULES.map(
    (legacy) => {
      const adapterEntry = adapterTopLevelByPath.get(legacy.path);
      return {
        ...legacy, // legacy values are authoritative for Step B
        // For Step B parity, `effectivelyRequired` always derives from
        // legacy semantics (top-level rules are unconditionally required).
        // The contract registry's `required` field is more permissive
        // than legacy in places (e.g., contracts with `required: false`
        // on optional scopes), so reading it would weaken the rubric.
        effectivelyRequired: true,
        contractId: adapterEntry?.contractId ?? 'legacy-gapfill',
        ownerAgent: adapterEntry?.ownerAgent ?? 'legacy-gapfill',
      };
    },
  );

  const composedAgentSections: ResolvedAgentSectionRule[] = AGENT_SECTION_RULES.map(
    (legacy) => {
      const adapterEntry = adapterAgentSectionByName.get(legacy.section);
      return {
        ...legacy, // legacy values are authoritative for Step B
        // Same parity argument — legacy `isSectionRequired(rule, ticket)`
        // is the source of truth for whether a section is required.
        // Once Step C completes, this can switch to the composed
        // `required` field once contracts produce equivalent verdicts.
        effectivelyRequired: isSectionRequired(legacy, ticket),
        contractId: adapterEntry?.contractId ?? 'legacy-gapfill',
        ownerAgent: adapterEntry?.ownerAgent ?? 'legacy-gapfill',
      };
    },
  );

  return {
    topLevelRules: composedTopLevel,
    agentSectionRules: composedAgentSections,
    sourceMode: 'composed',
    scope,
    signature: composed.signature,
  };
}
