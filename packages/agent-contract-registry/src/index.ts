/**
 * @chiefaia/agent-contract-registry — public entry point (ACR-002)
 *
 * The Agent Section Contract Registry. Each ticket-writing agent
 * (PO/BA/EA/Test-Design) registers a `SectionContract` declaring the
 * sections + per-scope rubrics it owns. The Story Validator consumes
 * `composeTemplate(scope)` instead of hard-coded `validation-rubric.ts`.
 *
 * Usage:
 *
 *   import { register, composeTemplate } from '@chiefaia/agent-contract-registry';
 *   import { poAgentContract } from './po-agent.contract';
 *   register(poAgentContract);
 *   const template = composeTemplate('story');  // ComposedTemplate
 */

export {
  ContractRegistry,
  getDefaultRegistry,
  resetDefaultRegistry,
} from './registry';
export type { RegistryEntry } from './registry';

export { composeTemplate, composeAllScopes } from './compose-template';
export type { ComposeOptions } from './compose-template';

export { computeSignature } from './signature';

// ACR-007 Step A — adapter that converts ComposedTemplate into the shape
// the existing Story Validator (validation-rubric.ts) consumes. Lets the
// Validator swap consumption from hard-coded constants to runtime-composed
// templates without changing its scoring logic. See architecture report §7.
export { toValidationRubric } from './validator-adapter';
export type {
  AdapterTopLevelRule,
  AdapterAgentSectionRule,
  AdapterRubric,
} from './validator-adapter';

// Re-export the contract types for convenience — callers don't need to
// also import from @chiefaia/ticket-template just to type a registration.
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
} from '@chiefaia/ticket-template';

import { getDefaultRegistry } from './registry';
import type { SectionContract } from '@chiefaia/ticket-template';

/**
 * Top-level convenience for the canonical pattern: register a contract on
 * the default singleton registry. Equivalent to
 * `getDefaultRegistry().register(contract)`.
 */
export function register(contract: SectionContract): void {
  getDefaultRegistry().register(contract);
}
