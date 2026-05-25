/**
 * @caia/business-proposal-generator — error union.
 *
 * Discriminated by `code` so callers can `switch` exhaustively.
 */

export type ProposalGeneratorErrorCode =
  | 'validation_failed'
  | 'plan_score_below_threshold'
  | 'ia_artifact_invalid'
  | 'llm_call_failed'
  | 'word_count_violation'
  | 'pandoc_not_found'
  | 'pandoc_failed'
  | 'envelope_invalid'
  | 'not_implemented'
  | 'reviewer_failed'
  | 'persistence_failed'
  | 'fsm_transition_failed'
  | 'internal';

export class ProposalGeneratorError extends Error {
  public readonly code: ProposalGeneratorErrorCode;
  public override readonly cause: unknown;
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(
    code: ProposalGeneratorErrorCode,
    message: string,
    cause?: unknown,
    context?: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'ProposalGeneratorError';
    this.code = code;
    this.cause = cause;
    this.context = Object.freeze({ ...(context ?? {}) });
  }
}

/** Thrown by a stub target generator to signal explicit V1 non-support. */
export class NotImplementedError extends ProposalGeneratorError {
  public readonly target: string;
  public constructor(target: string, message?: string) {
    super(
      'not_implemented',
      message ?? `target '${target}' is not implemented at V1 (stub generator)`,
      undefined,
      { target },
    );
    this.name = 'NotImplementedError';
    this.target = target;
  }
}

/** Thrown when pandoc is not on $PATH. */
export class PandocNotFoundError extends ProposalGeneratorError {
  public constructor(binaryPath: string, cause?: unknown) {
    super(
      'pandoc_not_found',
      `pandoc binary not found at '${binaryPath}'. Install pandoc (https://pandoc.org/installing.html) and ensure it is on $PATH, or pass pandocBinary in options.`,
      cause,
      { binaryPath },
    );
    this.name = 'PandocNotFoundError';
  }
}

/** Thrown when pandoc returns a non-zero exit code. */
export class PandocError extends ProposalGeneratorError {
  public readonly exitCode: number;
  public readonly stderr: string;
  public constructor(args: { exitCode: number; stderr: string; stdout?: string }) {
    super(
      'pandoc_failed',
      `pandoc exited with code ${args.exitCode}: ${args.stderr.slice(0, 500)}`,
      undefined,
      { exitCode: args.exitCode, stderr: args.stderr, stdout: args.stdout },
    );
    this.name = 'PandocError';
    this.exitCode = args.exitCode;
    this.stderr = args.stderr;
  }
}

export function isProposalGeneratorError(value: unknown): value is ProposalGeneratorError {
  return value instanceof ProposalGeneratorError;
}
