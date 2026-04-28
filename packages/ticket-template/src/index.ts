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
} from './schema';
export type { TicketTemplateV1, AgentSectionKey } from './schema';

export {
  validateTicket,
  isValidTicket,
  assertValidTicket,
} from './validate';
export type { ValidationError, ValidationResult } from './validate';

export { buildDraftTicket } from './build';
export type { DraftTicketInput } from './build';
