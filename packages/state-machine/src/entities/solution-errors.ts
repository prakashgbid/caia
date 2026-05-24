import type { SolutionState } from './solution-states.js';

export class InvalidSolutionTransitionError extends Error {
  readonly code = 'INVALID_SOLUTION_TRANSITION';
  readonly fromState: SolutionState;
  readonly toState: SolutionState;
  readonly causeReason: string;

  constructor(
    fromState: SolutionState,
    toState: SolutionState,
    cause: string,
  ) {
    super(
      `invalid solution transition: ${fromState} -> ${toState} (${cause})`,
    );
    this.name = 'InvalidSolutionTransitionError';
    this.fromState = fromState;
    this.toState = toState;
    this.causeReason = cause;
  }
}

export class SolutionNotFoundError extends Error {
  readonly code = 'SOLUTION_NOT_FOUND';
  readonly solutionId: string;
  constructor(solutionId: string) {
    super(`solution not found: ${solutionId}`);
    this.name = 'SolutionNotFoundError';
    this.solutionId = solutionId;
  }
}

export class StaleSolutionVersionError extends Error {
  readonly code = 'STALE_SOLUTION_VERSION';
  readonly solutionId: string;
  readonly expectedVersion: number;
  constructor(solutionId: string, expectedVersion: number) {
    super(
      `stale solution version for ${solutionId}: caller expected ${expectedVersion}`,
    );
    this.name = 'StaleSolutionVersionError';
    this.solutionId = solutionId;
    this.expectedVersion = expectedVersion;
  }
}

export class SolutionTransitionRetryExhaustedError extends Error {
  readonly code = 'SOLUTION_TRANSITION_RETRY_EXHAUSTED';
  readonly solutionId: string;
  readonly attempts: number;
  constructor(solutionId: string, attempts: number) {
    super(
      `solution transition for ${solutionId} retry budget exhausted after ${attempts} attempts`,
    );
    this.name = 'SolutionTransitionRetryExhaustedError';
    this.solutionId = solutionId;
    this.attempts = attempts;
  }
}

export class DuplicateSolutionIdError extends Error {
  readonly code = 'DUPLICATE_SOLUTION_ID';
  readonly solutionId: string;
  constructor(solutionId: string) {
    super(`solution already registered: ${solutionId}`);
    this.name = 'DuplicateSolutionIdError';
    this.solutionId = solutionId;
  }
}
