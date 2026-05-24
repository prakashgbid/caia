/**
 * @caia/time-machine-architect — public surface.
 */

import type { ArchitectRegistry } from './types.js';

import { TimeMachineArchitect } from './architect.js';

export {
  TimeMachineArchitect,
  TIME_MACHINE_ARCHITECT_NAME,
  TIME_MACHINE_ARCHITECT_TOOLS
} from './architect.js';
export type { TimeMachineArchitectConfig } from './architect.js';

export {
  TimeMachineArchitectContract,
  TIME_MACHINE_OWNED_SECTIONS,
  TIME_MACHINE_OWNED_FIELD_KEYS,
  TIME_MACHINE_FIELD_FIX_HINTS,
  TIME_MACHINE_ARCHITECT_META,
  timeMachineArchitectAppliesPredicate
} from './contract.js';

export { buildTimeMachineSystemPrompt } from './system-prompt.js';

export {
  createDefaultSpawner,
  buildSpawnPrompt,
  modelTagFor
} from './spawner.js';
export type {
  ArchitectSpawnerFn,
  ArchitectSpawnInput,
  ArchitectSpawnOutput
} from './spawner.js';

export { runTimeMachineArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

export { TIME_MACHINE_INVARIANTS } from './invariants.js';
export type { ArchitectInvariant, InvariantSeverity } from './invariants.js';

export type {
  SpecialistArchitect,
  ArchitectInput,
  ArchitectOutput,
  ArchitectUpstreamContext,
  ArchitectBudget,
  ArchitectSpend,
  ArchitectToolCall,
  ReviewerFeedback,
  Ticket,
  BusinessPlan,
  RenderableDesign,
  TenantContext,
  ToolDefinition,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  ArchitectMeta,
  FanoutPolicy
} from './types.js';

export function registerWith(registry: ArchitectRegistry): TimeMachineArchitect {
  const architect = new TimeMachineArchitect();
  registry.register(architect);
  return architect;
}
