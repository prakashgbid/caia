/**
 * @caia/interviewer — structured error codes.
 *
 * Every failure mode is enumerated so downstream surfaces (dashboard,
 * server actions, CLI) can map them to user-facing copy without
 * brittle string parsing.
 */

export type InterviewerErrorCode =
  | 'invalid_state_transition'
  | 'terminal_state_locked'
  | 'budget_exceeded'
  | 'playbook_parse_error'
  | 'playbook_missing_question'
  | 'plan_validation_failed'
  | 'critic_parse_error'
  | 'critic_call_failed'
  | 'llm_call_failed'
  | 'llm_parse_error'
  | 'persistence_failure'
  | 'duplicate_turn'
  | 'unknown_interview'
  | 'resume_invalid_state'
  | 'force_close_after_terminal'
  | 'question_lint_rejected'
  | 'rubric_underflow';

export class InterviewerError extends Error {
  public readonly code: InterviewerErrorCode;
  public readonly context: Readonly<Record<string, unknown>>;

  public constructor(
    code: InterviewerErrorCode,
    message: string,
    context: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = 'InterviewerError';
    this.code = code;
    this.context = context;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
