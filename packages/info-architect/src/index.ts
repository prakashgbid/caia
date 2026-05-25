/**
 * @caia/info-architect — public barrel.
 *
 * Re-exports the public surface of the package. See `README.md` and
 * `PLAN.md` for design rationale.
 */

export {
  InfoArchitectError,
  isInfoArchitectError,
  type InfoArchitectErrorCode,
} from './errors.js';

export {
  IA_CRITIC_SCORE_FLOOR,
  IA_INPUT_COMPLETENESS_FLOOR,
  isIaInput,
  isIaOutput,
  type AtomicTier,
  type BuildPath,
  type ColorScale,
  type ComponentRecord,
  type ComponentsLibrary,
  type CredentialArchetype,
  type DesignSystem,
  type FrameworkChoice,
  type FsmTransition,
  type IaAgent,
  type IaBusinessPlanSlice,
  type IaInput,
  type IaOutput,
  type IaPersistence,
  type IaStateMachineAdapter,
  type IaTenantContext,
  type NarrativeRole,
  type PageRecord,
  type PagesCatalogue,
  type ProjectType,
  type ShadcnComponentName,
  type TemplateRecord,
} from './types.js';

export {
  InfoArchitectAgent,
  synthesiseSkeletonOutput,
  type InfoArchitectAgentOptions,
  type SpawnClaudeFn,
} from './agent.js';

export {
  IaMemoryPersistence,
  IaPostgresPersistence,
  DEFAULT_MIGRATION_PATH,
  tenantSchemaName,
  type IaMemoryPersistenceOptions,
  type IaPostgresPersistenceOptions,
  type PgClientLike,
  type PgPoolLike,
} from './persistence.js';

export {
  runInformationArchitecture,
  type RunInfoArchitectureDeps,
  type RunInfoArchitectureResult,
} from './api.js';

export {
  buildIaSystemPrompt,
  CREDENTIAL_ARCHETYPES,
  IA_PILLARS,
  type BuildIaSystemPromptOptions,
  type CredentialArchetypeDescriptor,
} from './system-prompt.js';
