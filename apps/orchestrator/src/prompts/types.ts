export type PromptStatus = 'received' | 'analyzing' | 'decomposed' | 'answered' | 'failed';
export type PromptReceivedVia = 'chat' | 'api' | 'cli' | 'scheduled-task';
export type PromptResponseKind = 'decomposition' | 'chat' | 'clarification' | 'error';
export type TransitionActor = 'user' | 'executor' | 'sentinel' | 'worker' | 'scheduler' | 'breaker' | 'system';

export interface Prompt {
  id: string;
  body: string;
  receivedAt: string;
  receivedVia: PromptReceivedVia;
  userId?: string | null;
  sessionId?: string | null;
  correlationId: string;
  hash: string;
  tokensIn?: number | null;
  metadataJson: string;
  status: PromptStatus;
  completedAt?: string | null;
  elapsedMs?: number | null;
  /** RUN-MODES (migration 0038): 'full' | 'plan-only' | 'test-only'. */
  runMode?: import('../run-modes').RunMode;
}

export interface PromptResponse {
  id: string;
  promptId: string;
  responseBody: string;
  respondedAt: string;
  responseKind: PromptResponseKind;
  tokensOut?: number | null;
  decompositionTreeJson?: string | null;
}

export interface TaskStatusTransition {
  id: number;
  taskId: string;
  fromStatus?: string | null;
  toStatus: string;
  transitionedAt: string;
  actor: TransitionActor;
  triggerEventId?: string | null;
  notes?: string | null;
  rootPromptId?: string | null;
}

export interface CreatePromptParams {
  body: string;
  receivedVia?: PromptReceivedVia;
  sessionId?: string;
  userId?: string;
  tokensIn?: number;
  metadata?: Record<string, unknown>;
  /** Optional run mode; defaults to 'full' if absent. */
  runMode?: import('../run-modes').RunMode;
}

export interface PromptDescendant {
  entityType: 'story' | 'requirement' | 'task' | 'task_run' | 'blocker' | 'question';
  entityId: string;
  title?: string;
  status: string;
  createdAt: string;
  parentEntityType?: string | null;
  parentEntityId?: string | null;
}

export interface PromptJourney {
  promptId: string;
  receivedAt: string;
  status: PromptStatus;
  elapsedMs?: number | null;
  timeToFirstTaskMs?: number | null;
  timeToAllDoneMs?: number | null;
  countByStatus: Record<string, number>;
  circuitBreakerTrips: number;
  reExecutionCount: number;
  totalEvents: number;
  descendants: {
    stories: number;
    requirements: number;
    tasks: number;
    taskRuns: number;
    blockers: number;
    questions: number;
    total: number;
  };
}

export interface PromptListOptions {
  since?: string;
  userId?: string;
  status?: PromptStatus;
  limit?: number;
  cursor?: string;
}
