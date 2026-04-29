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
