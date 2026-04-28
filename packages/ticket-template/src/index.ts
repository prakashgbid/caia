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
  // BUCKET-001 taxonomy enums + types
  PROJECT_SLUGS,
  LIFECYCLE_VALUES,
  RISK_VALUES,
  EFFORT_VALUES,
  PRIORITY_VALUES,
  QUALITY_TAGS,
  TECH_SUB_DOMAINS,
  // TEST-001 testing framework taxonomy + bounds
  TEST_CASE_CATEGORIES,
  TEST_CASE_STATUSES,
  TEST_CASE_LAYERS,
  MIN_TEST_CASES,
  MAX_TEST_CASES,
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
  // TEST-001 test case types
  TestCase,
  TestCaseCategory,
  TestCaseStatus,
  TestCaseLayer,
} from './schema';

export {
  validateTicket,
  isValidTicket,
  assertValidTicket,
} from './validate';
export type { ValidationError, ValidationResult } from './validate';

export { buildDraftTicket } from './build';
export type { DraftTicketInput } from './build';
