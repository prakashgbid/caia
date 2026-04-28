/**
 * Custom error classes for the orchestrator-middleware enforcement layer.
 * Each error carries structured data so callers can log violations without
 * reparsing the message string.
 *
 * @no-events — error constructors are infrastructure; no domain events emitted.
 */

import type { BannedPhraseMatch } from './types.js';

/**
 * Thrown by `assertNoBannedPhrases` when the outbound message contains one or
 * more AUTON-001/002/006/007/008 banned phrases.
 */
export class BannedPhraseError extends Error {
  readonly violations: BannedPhraseMatch[];

  constructor(violations: BannedPhraseMatch[]) {
    const summary = violations.map(v => `"${v.phrase}" at pos ${v.position}`).join(', ');
    super(`AUTON: outbound message contains banned phrases — ${summary}`);
    this.name = 'BannedPhraseError';
    this.violations = violations;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown by `PromptContext.assertHasRootPromptId` when a decomposition or
 * task spawn is attempted before `prompt_create` has been called (TRACE-001).
 */
export class MissingRootPromptError extends Error {
  readonly context: string;

  constructor(context: string) {
    super(`TRACE-001: root_prompt_id is not set — prompt_create must be called first. Context: ${context}`);
    this.name = 'MissingRootPromptError';
    this.context = context;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/**
 * Thrown (or surfaced as a violation) when `task_run_record` was never called
 * for a spawned task within the TTL window (TASK-001).
 */
export class TaskRunNotRecordedError extends Error {
  readonly sessionId: string;
  /** Milliseconds elapsed since the task was spawned. */
  readonly elapsed: number;

  constructor(sessionId: string, elapsed: number) {
    super(
      `TASK-001: task_run_record was not called for session "${sessionId}" within ${elapsed}ms`,
    );
    this.name = 'TaskRunNotRecordedError';
    this.sessionId = sessionId;
    this.elapsed = elapsed;
    Object.setPrototypeOf(this, new.target.prototype);
  }
}
