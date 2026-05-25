/** @caia/grand-idea — public surface. Stage 2: persist founder's prompt + advance FSM. */
export {
  GRAND_IDEA_WORD_CEILING,
  GRAND_IDEA_WORD_FLOOR,
  captureRequestSchema,
  computeWordCount,
} from './types.js';
export type {
  CaptureRequest,
  CaptureResponse,
  CaptureResponseError,
  CaptureResponseOk,
  CaptureResult,
  GrandIdeaRow,
  PgClient,
  PgPoolLike,
  PgQueryRunner,
  TenantRecord,
} from './types.js';

export { GrandIdeaError, isGrandIdeaError } from './errors.js';
export type { GrandIdeaErrorCode } from './errors.js';

export {
  DEFAULT_MIGRATION_PATH,
  GrandIdeaPersistence,
  MemoryGrandIdeaPersistence,
  tenantSchemaName,
} from './persistence.js';
export type {
  GrandIdeaPersistenceOptions,
  IGrandIdeaPersistence,
  MemoryPersistenceOptions,
  WriteGrandIdeaInput,
} from './persistence.js';

export { advanceToIdeaCaptured } from './state-machine.js';
export type {
  AdvanceToIdeaCapturedInput,
  AdvanceToIdeaCapturedResult,
} from './state-machine.js';

export {
  RejectAccessVerifier,
  StaticAccessVerifier,
  createCaptureHandler,
} from './api.js';
export type {
  CaptureHandlerOptions,
  CloudflareAccessVerifier,
  HandlerResponse,
  RawRequest,
} from './api.js';

export const GRAND_IDEA_CONTRACT = Object.freeze({
  agentId: '@caia/grand-idea' as const,
  role: 'pipeline-stage-2-capture' as const,
  fsmTransitions: [
    { from: 'onboarding' as const, to: 'idea-captured' as const, reason: 'grand-idea-captured' as const },
  ],
  consumesEvents: [] as const,
  emitsEvents: ['grand_idea.captured' as const],
  artifacts: {
    reads: ['caia_meta.tenants'] as const,
    writes: ['caia_<tenant>.grand_ideas'] as const,
  },
});
