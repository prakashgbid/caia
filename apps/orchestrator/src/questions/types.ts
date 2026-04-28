export type QuestionState = 'open' | 'answered' | 'cancelled';

export type QuestionPriority = 'urgent' | 'normal' | 'nice-to-have';

export interface Recommendation {
  id: string;              // rec_A, rec_B, etc.
  label: string;
  rationale: string;
  isDefault?: boolean;
}

export interface QuestionAnswer {
  kind: 'accepted-recommendation' | 'custom';
  recommendationId?: string;
  customText?: string;
}

export interface Question {
  id: string;              // qst_XXXX
  title: string;
  createdAt: string;
  state: QuestionState;
  priority: QuestionPriority;
  requirementId?: string;
  taskId?: string;
  context: string;
  recommendations: Recommendation[];
  customAnswerPlaceholder?: string;
  answeredAt?: string;
  answer?: QuestionAnswer;
}

export type QuestionEventType =
  | 'QUESTION_CREATED'
  | 'QUESTION_ANSWERED'
  | 'QUESTION_CANCELLED'
  | 'QUESTION_SNAPSHOT_REBUILT';

export interface QuestionEvent {
  id: string;
  type: QuestionEventType;
  questionId: string;
  timestamp: string;
  payload?: unknown;
}

export interface QuestionsState {
  questions: Record<string, Question>;
  lastEventId: string;
  rebuiltAt?: string;
}

export interface DrainedQuestion {
  question: Question;
}

export interface QuestionDrainResult {
  answeredQuestions: DrainedQuestion[];
}

export interface CreateQuestionParams {
  title: string;
  priority: QuestionPriority;
  context: string;
  recommendations: Recommendation[];
  customAnswerPlaceholder?: string;
  requirementId?: string;
  taskId?: string;
}
