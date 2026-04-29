/**
 * @chiefaia/agent-contract-registry — validator-adapter.ts (ACR-007 Step A)
 *
 * Bridges the contract registry's runtime-composed templates to the shape
 * the existing Story Validator (validation-rubric.ts) consumes. Lets the
 * Validator switch from hard-coded `TOP_LEVEL_SECTION_RULES` /
 * `AGENT_SECTION_RULES` to per-scope composed templates without changing
 * its 6-step pipeline.
 *
 * **Phasing (per architecture report section 7):**
 *
 *   Step A (THIS PR): adapter exists; both rubric sources can be queried;
 *     CI snapshot tests assert parity in shape so the swap is safe.
 *   Step B (post VAL-### merge): Validator's runtime call site flips to
 *     consume `toValidationRubric(composeTemplate(scope))`. Adapter
 *     output replaces hard-coded constants behind a feature flag.
 *   Step C (post drift-free window): hard-coded rule arrays in
 *     validation-rubric.ts deleted; only helper functions remain.
 *
 * The adapter's job is purely structural: map ComposedSectionEntry into
 * either a TopLevelSectionRule or an AgentSectionRule depending on the
 * section name's path.
 */

import type {
  ComposedSectionEntry,
  ComposedTemplate,
} from '@chiefaia/ticket-template';

/**
 * Adapter output — mirrors what validation-rubric.ts exports today,
 * minus the `trigger` field on AgentSectionRule (composition has already
 * resolved scope to a fixed required/optional decision).
 */
export interface AdapterTopLevelRule {
  path: string;
  purpose: string;
  minWords: number;
  forbidSnippets: boolean;
  runContentRelevance: boolean;
  severityOnFail: 'hard' | 'soft' | 'warning';
  fixHint: string;
  /** Source contract for failure attribution. */
  contractId: string;
  ownerAgent: string;
  required: boolean;
}

export interface AdapterAgentSectionRule {
  /** The `agentSections.<key>` suffix — e.g. 'architecture', 'api'. */
  section: string;
  purpose: string;
  minWords: number;
  minItemsPerSubField?: Readonly<Record<string, number>>;
  requiredEntityRefs?: ReadonlyArray<{ label: string; pattern: string; flags?: string }>;
  forbidSnippets: boolean;
  extraForbiddenSnippets?: readonly string[];
  runContentRelevance: boolean;
  severityOnFail: 'hard' | 'soft' | 'warning';
  fixHint: string;
  /** Composition has resolved this — true means present-required, false means optional. */
  required: boolean;
  /** Source contract for failure attribution. */
  contractId: string;
  ownerAgent: string;
}

export interface AdapterRubric {
  topLevelRules: readonly AdapterTopLevelRule[];
  agentSectionRules: readonly AdapterAgentSectionRule[];
  /** Sections whose `name` doesn't fit the top-level / agentSections.* pattern. */
  otherSections: readonly AdapterAgentSectionRule[];
}

/**
 * Top-level paths the Validator's existing TOP_LEVEL_SECTION_RULES uses.
 * Sections whose name matches one of these are converted to
 * AdapterTopLevelRule; everything else is treated as an agent section.
 */
const TOP_LEVEL_PATHS = new Set([
  'scope',
  'context',
  'acceptanceCriteria',
  'verificationPlan',
  'dependencies',
]);

function entryToTopLevel(name: string, entry: ComposedSectionEntry): AdapterTopLevelRule {
  return {
    path: name,
    purpose: entry.spec.purpose,
    minWords: entry.effectiveRubric.minWords ?? 0,
    forbidSnippets:
      (entry.effectiveRubric.forbiddenSnippets?.length ?? 0) > 0,
    // The current validator runs LLM relevance on every text-y top-level
    // section. We mirror by enabling it whenever a relevance prompt seed
    // is present on the section.
    runContentRelevance: !!entry.effectiveRubric.relevancePromptSeed,
    severityOnFail: entry.effectiveRubric.severityOnFail,
    fixHint: entry.effectiveRubric.fixHint,
    contractId: entry.contractId,
    ownerAgent: entry.ownerAgent,
    required: entry.effectiveRequired,
  };
}

function entryToAgentSection(name: string, entry: ComposedSectionEntry): AdapterAgentSectionRule {
  // Strip the 'agentSections.' prefix when present; otherwise use the full
  // section name (so 'architecturalInstructions' carries its own name).
  const section = name.startsWith('agentSections.')
    ? name.slice('agentSections.'.length)
    : name;
  return {
    section,
    purpose: entry.spec.purpose,
    minWords: entry.effectiveRubric.minWords ?? 0,
    ...(entry.effectiveRubric.minItemsPerSubField !== undefined && {
      minItemsPerSubField: entry.effectiveRubric.minItemsPerSubField,
    }),
    ...(entry.effectiveRubric.requiredEntityRefs !== undefined && {
      requiredEntityRefs: entry.effectiveRubric.requiredEntityRefs,
    }),
    forbidSnippets: (entry.effectiveRubric.forbiddenSnippets?.length ?? 0) > 0,
    ...(entry.effectiveRubric.forbiddenSnippets !== undefined && {
      extraForbiddenSnippets: entry.effectiveRubric.forbiddenSnippets,
    }),
    runContentRelevance: !!entry.effectiveRubric.relevancePromptSeed,
    severityOnFail: entry.effectiveRubric.severityOnFail,
    fixHint: entry.effectiveRubric.fixHint,
    required: entry.effectiveRequired,
    contractId: entry.contractId,
    ownerAgent: entry.ownerAgent,
  };
}

/**
 * Split a `ComposedTemplate` into top-level vs agent-section rules in
 * the shape the existing Validator consumes. This is the bridge that
 * lets ACR-007 Step B flip the Validator over without changing its
 * scoring logic.
 */
export function toValidationRubric(template: ComposedTemplate): AdapterRubric {
  const topLevelRules: AdapterTopLevelRule[] = [];
  const agentSectionRules: AdapterAgentSectionRule[] = [];
  const otherSections: AdapterAgentSectionRule[] = [];

  for (const [name, entry] of template.sections) {
    if (TOP_LEVEL_PATHS.has(name)) {
      topLevelRules.push(entryToTopLevel(name, entry));
    } else if (name.startsWith('agentSections.')) {
      agentSectionRules.push(entryToAgentSection(name, entry));
    } else {
      // Architectural instructions, taxonomy.*, claims, businessOutcome,
      // testCases, testDesign, etc. — treated as "other" so the Validator
      // can run rubric checks without confusing them with the legacy
      // agentSections.<key> structure.
      otherSections.push(entryToAgentSection(name, entry));
    }
  }

  return { topLevelRules, agentSectionRules, otherSections };
}
