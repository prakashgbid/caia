/**
 * @caia/info-architect — typed error taxonomy.
 *
 * The orchestrator and adapters bubble these to callers so the FSM
 * adapter can map them to `information-architecture-failed` with a
 * structured reason in the history payload.
 */

export type InfoArchitectErrorCode =
  /** Caller passed an input that doesn't match `IaInput` shape. */
  | 'validation_failed'
  /** A subscription-only constraint was violated. */
  | 'subscription_only_violation'
  /** Claude spawner returned ok=false or produced unparsable output. */
  | 'llm_call_failed'
  /** LLM output failed JSON parse / shape validation. */
  | 'llm_parse_error'
  /** Critic loop scored the artifacts below the §9.13 floor. */
  | 'critic_score_below_floor'
  /** Persistence layer (Postgres) returned an error. */
  | 'persistence_failed'
  /** FSM transition was rejected by `@caia/state-machine`. */
  | 'fsm_transition_failed'
  /** Project is not in `interview-complete` when `runInformationArchitecture` is called. */
  | 'project_state_invalid'
  /** Advisory lock was already held by a concurrent run. */
  | 'advisory_lock_contended'
  /** Schema validation against IA Zod schemas failed. */
  | 'schema_validation_failed';

export class InfoArchitectError extends Error {
  public readonly code: InfoArchitectErrorCode;
  public override readonly cause?: unknown;
  public readonly context?: Readonly<Record<string, unknown>>;

  public constructor(
    code: InfoArchitectErrorCode,
    message: string,
    cause?: unknown,
    context?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'InfoArchitectError';
    this.code = code;
    if (cause !== undefined) this.cause = cause;
    if (context !== undefined) this.context = context;
  }
}

export function isInfoArchitectError(value: unknown): value is InfoArchitectError {
  return value instanceof InfoArchitectError;
}
