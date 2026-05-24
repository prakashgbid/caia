/**
 * @caia/testing-architect — public surface.
 *
 * Architect #16 of CAIA's 17-architect EA fan-out. Depends on Frontend
 * + Backend + Database upstream outputs to set the testing STRATEGY
 * for the whole stack.
 *
 * DISTINCTION: Testing Architect sets STRATEGY. Test Author Agent writes
 * test cases per story; Test Reviewer Agent audits coverage.
 */

import type { ArchitectRegistry } from './types.js';

import { TestingArchitect } from './architect.js';

export {
  TestingArchitect,
  TESTING_ARCHITECT_NAME,
  TESTING_ARCHITECT_TOOLS
} from './architect.js';
export type { TestingArchitectConfig } from './architect.js';

export {
  TestingArchitectContract,
  TESTING_OWNED_SECTIONS,
  TESTING_OWNED_FIELD_KEYS,
  TESTING_FIELD_FIX_HINTS,
  TESTING_ARCHITECT_META,
  REQUIRED_TEST_TYPES,
  ALLOWED_PYRAMID_SHAPES,
  ALLOWED_MUTATION_TOOLS,
  ALLOWED_E2E_RUNNERS,
  TESTING_HARD_FLOORS,
  testingArchitectAppliesPredicate
} from './contract.js';

export { buildTestingSystemPrompt } from './system-prompt.js';

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

export { runTestingArchitect, buildUserPrompt } from './run.js';
export type { RunDeps } from './run.js';

export { validateArchitectOutput, stripFences } from './validation.js';
export type { ValidationError, ValidationResult } from './validation.js';

export { TESTING_INVARIANTS } from './invariants.js';
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

export function registerWith(registry: ArchitectRegistry): TestingArchitect {
  const architect = new TestingArchitect();
  registry.register(architect);
  return architect;
}
