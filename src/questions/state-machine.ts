import type { QuestionState } from './types';

export const QUESTION_TRANSITIONS: Record<QuestionState, QuestionState[]> = {
  open:      ['answered', 'cancelled'],
  answered:  [],
  cancelled: [],
};

export function canQuestionTransition(from: QuestionState, to: QuestionState): boolean {
  return (QUESTION_TRANSITIONS[from] ?? []).includes(to);
}

export function assertQuestionTransition(from: QuestionState, to: QuestionState): void {
  if (!canQuestionTransition(from, to)) {
    throw new Error(
      `Invalid question transition: ${from} → ${to}. Allowed from ${from}: [${(QUESTION_TRANSITIONS[from] ?? []).join(', ')}]`,
    );
  }
}
