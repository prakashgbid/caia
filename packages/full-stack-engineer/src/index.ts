/**
 * @caia/full-stack-engineer — Stage 13 of the canonical pipeline.
 *
 * Per-ticket coding worker subagent. Reads EA-approved + Test-authored
 * ticket; implements code (frontend + backend + database + tests) per
 * the architects' specs; opens PR; awaits per-story-tester pass.
 * N of these run in parallel under Principal Engineer's scheduling.
 *
 * Public surface re-exports.
 */

// ─── API ────────────────────────────────────────────────────────────────
export { runFullStackEngineer } from './api.js';

// ─── Agent (system prompt + prompt builder) ─────────────────────────────
export {
  FULL_STACK_ENGINEER_SYSTEM_PROMPT,
  buildEngineerPrompt,
} from './agent.js';

// ─── Work claimer ───────────────────────────────────────────────────────
export { claimTicket } from './work-claimer.js';
export type { ClaimTicketInput } from './work-claimer.js';

// ─── Spec reader ────────────────────────────────────────────────────────
export {
  readSpec,
  findStackLockViolations,
  SHADCN_STACK_LOCK,
} from './spec-reader.js';

// ─── Code emitter ───────────────────────────────────────────────────────
export {
  createSpawnedEmitter,
  createDeterministicEmitter,
  extractFilePlan,
  validateFilePlan,
  EmitterError,
} from './code-emitter.js';
export type {
  SpawnedEmitterOptions,
  ValidatedFilePlan,
  InvalidFilePlan,
} from './code-emitter.js';

// ─── PR opener ──────────────────────────────────────────────────────────
export {
  openPr,
  composePrTitle,
  composePrBody,
  composeCommitMessage,
  PrOpenerError,
} from './pr-opener.js';
export type { OpenPrInput } from './pr-opener.js';

// ─── Types ──────────────────────────────────────────────────────────────
export type {
  BackendBriefSection,
  ClaimOutcome,
  ClaimTransitionOutcome,
  ComponentSpec,
  CrosscuttingBriefSection,
  DatabaseBriefSection,
  Emitter,
  EmittedFile,
  EmittedFiles,
  EndpointSpec,
  EngineerResult,
  FrontendBriefSection,
  FullStackEngineerConfig,
  GitAdapter,
  ImplementationBrief,
  LoadedTicket,
  LocalGateResult,
  LocalGateRunner,
  MigrationSpec,
  PrOutcome,
  RepositorySpec,
  RouteSpec,
  ServiceSpec,
  StackLockBlock,
  StateModuleSpec,
  TestsBriefSection,
  TicketStore,
  WorkerSubState,
} from './types.js';
