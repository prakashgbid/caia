/**
 * @caia/grand-idea — error union.
 *
 * Discriminated by `code` so callers can `switch` exhaustively.
 */

export type GrandIdeaErrorCode =
  | 'validation_failed'
  | 'tenant_not_found'
  | 'tenant_not_onboarded'
  | 'project_state_invalid'
  | 'fsm_transition_failed'
  | 'auth_missing'
  | 'auth_invalid'
  | 'persistence_failed'
  | 'internal';

export class GrandIdeaError extends Error {
  public readonly code: GrandIdeaErrorCode;
  public override readonly cause: unknown;
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(
    code: GrandIdeaErrorCode,
    message: string,
    cause?: unknown,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'GrandIdeaError';
    this.code = code;
    this.cause = cause;
    this.context = Object.freeze({ ...(context ?? {}) });
  }

  public toJSON(): {
    name: string;
    code: GrandIdeaErrorCode;
    message: string;
    context: Record<string, unknown>;
  } {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: { ...this.context },
    };
  }
}

export function isGrandIdeaError(value: unknown): value is GrandIdeaError {
  return value instanceof GrandIdeaError;
}
