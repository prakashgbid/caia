/**
 * Public entry point for @chiefaia/ticket-template.
 *
 * Re-exports the v1 schema, types, validation helpers, builder, and
 * constants. Add future versions (v2 etc.) as parallel exports — never
 * mutate v1.
 */

export {
  TicketTemplateV1Schema,
  TICKET_TEMPLATE_VERSION,
  MIN_ACCEPTANCE_CRITERIA,
  MAX_ACCEPTANCE_CRITERIA,
  NATURE_VALUES,
  COMPLEXITY_VALUES,
  AGENT_SECTION_KEYS,
  PROJECT_SLUGS,
  LIFECYCLE_VALUES,
  RISK_VALUES,
  EFFORT_VALUES,
  PRIORITY_VALUES,
  QUALITY_TAGS,
  TECH_SUB_DOMAINS,
  // 0025 — input-dependency runtime constants
  INPUT_DEPENDENCY_KINDS,
  INPUT_DEPENDENCY_DECLARERS,
  // TEST-001 testing framework taxonomy + bounds
  TEST_CASE_CATEGORIES,
  TEST_CASE_STATUSES,
  TEST_CASE_LAYERS,
  MIN_TEST_CASES,
  MAX_TEST_CASES,
  // ARCH-006 architecturalInstructions[] schema
  ArchitecturalInstructionSchema,
  ARCH_INSTRUCTION_ACTIONS,
  // ARCH-007 — ArchitecturalInstructionV2 (additive over V1) + supporting enums
  ArchitecturalInstructionV2Schema,
  ARTIFACT_KINDS,
  INTEGRATION_DIRECTIONS,
  INTEGRATION_PROTOCOLS,
  RISK_SEVERITIES,
  TEST_HOOK_KINDS,
  CROSS_CUTTING_CONCERNS,
  ARTIFACT_ROLES,
  RADAR_RINGS,
} from './schema';
export type {
  TicketTemplateV1,
  AgentSectionKey,
  ProjectSlug,
  LifecycleValue,
  RiskValue,
  EffortValue,
  PriorityValue,
  QualityTag,
  TechSubDomain,
  // 0025 — input-dependency types
  InputDependency,
  InputDependencyKind,
  InputDependencyDeclarer,
  // TEST-001 test case types
  TestCase,
  TestCaseCategory,
  TestCaseStatus,
  TestCaseLayer,
  // ARCH-006 architectural-instruction types
  ArchitecturalInstruction,
  ArchInstructionAction,
  // ARCH-007 architectural-instruction-v2 types
  ArchitecturalInstructionV2,
  ArtifactKind,
  IntegrationDirection,
  IntegrationProtocol,
  RiskSeverity,
  TestHookKind,
  CrossCuttingConcern,
  ArtifactRole,
  RadarRing,
  ExistingArtifactReference,
  NewArtifactSpec,
  IntegrationPoint,
  Risk,
  TestHook,
  CandidateADR,
} from './schema';

export {
  validateTicket,
  isValidTicket,
  assertValidTicket,
} from './validate';
export type { ValidationError, ValidationResult } from './validate';

export { buildDraftTicket } from './build';
export type { DraftTicketInput } from './build';

// VAL-001 — validation rubric for the Story Validator Agent.
export {
  RUBRIC_VERSION,
  UNIVERSAL_FORBIDDEN_SNIPPETS,
  TOP_LEVEL_SECTION_RULES,
  AGENT_SECTION_RULES,
  AC_ITEM_RULES,
  CROSS_SECTION_CONSISTENCY_PROMPT_SEED,
  COMPLETENESS_GESTALT_PROMPT_SEED,
  VERDICT_THRESHOLDS,
  SCORE_WEIGHTS,
  buildContentRelevancePrompt,
  isSectionRequired,
  countWordsInValue,
  findForbiddenSnippets,
  concatStrings,
} from './validation-rubric';
export type {
  RubricVersion,
  RubricSeverity,
  TopLevelSectionRule,
  AgentSectionRule,
  SectionTrigger,
} from './validation-rubric';

// ACR-001 — Agent Section Contract Registry primitives.
export {
  STORY_SCOPES,
  STORY_SCOPE_ORDER,
  isStoryScope,
  DEFAULT_STORY_SCOPE,
  AGENT_ROLES,
  AGENT_ORDER,
  applyScopeOverride,
  compareScopes,
  isScopeAtLeastAsCoarseAs,
} from './section-contract';
export type {
  StoryScope,
  AgentRole,
  ContractSeverity,
  SectionRubric,
  SectionExample,
  SectionSpec,
  SectionContract,
  ComposedSectionEntry,
  ComposedTemplate,
} from './section-contract';

// CAPSULE-FORMALIZE — Context Capsule formalization (third-party paper §C.5).
export {
  CAPSULE_SLICE_KEYS,
  CAPSULE_VERSION,
  canonicalize,
  canonicalJSON,
  computeCapsuleHash,
  extractCapsule,
  freezeCapsule,
  verifyCapsule,
} from './capsule';
export type {
  AgentSections,
  CapsuleBudget,
  CapsuleContent,
  CapsuleDrift,
  CapsuleSliceKey,
  CapsuleVerification,
  CapsuleVersion,
  FreezeOptions,
  TicketWithCapsule,
  VerifiableTicket,
} from './capsule';
