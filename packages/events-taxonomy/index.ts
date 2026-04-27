/**
 * Canonical event taxonomy for Conductor.
 * All modules import types from here — no drift.
 * Schema version: 1
 */

export type EventSeverity = 'debug' | 'info' | 'warning' | 'error';

export type EventActor =
  | 'user'
  | 'executor'
  | 'ci'
  | 'api'
  | 'mcp'
  | 'system'
  | 'story-decomposer'
  | 'completeness-sentinel'
  | 'db-backup'
  | 'build-runner'
  | 'behavior-runner'
  | 'worker'
  | 'prioritizer'
  | 'secrets-broker'
  | 'scaffolder';

/** Canonical envelope for every event emitted through the bus */
export interface ConductorEvent {
  /** ULID — globally unique, sortable */
  id: string;
  /** Dot-namespaced type from registry.yaml */
  type: EventType;
  /** ISO 8601 with nanosecond suffix where available */
  occurred_at: string;
  actor: EventActor;
  /** Groups causally related events (e.g. one build run) */
  correlation_id?: string;
  /** ID of the event that caused this one */
  causation_id?: string;
  /** OpenTelemetry trace ID */
  trace_id?: string;
  /** OpenTelemetry span ID */
  span_id?: string;
  entity_type?: string;
  entity_id?: string;
  project_slug?: string;
  domain_slugs?: string[];
  payload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  severity: EventSeverity;
}

// ─── Pipeline ────────────────────────────────────────────────────────────────

export interface PipelineStartedPayload { project_slug: string; trigger: string }
export interface PipelineCompletedPayload { project_slug: string; trigger: string; duration_ms: number; outcome: string }
export interface PipelineFailedPayload { project_slug: string; trigger: string; duration_ms: number; error: string }
export interface PipelineDecomposeStartedPayload { story_id: string; project_slug: string }
export interface PipelineDecomposeCompletedPayload { story_id: string; children_count: number }

// ─── Story ───────────────────────────────────────────────────────────────────

export interface StoryCreatedPayload { story_id: string; title: string; kind: string; project_slug?: string }
export interface StoryUpdatedPayload { story_id: string; fields_changed: string[] }
export interface StoryStatusChangedPayload { story_id: string; from_status: string; to_status: string }
export interface StoryDeletedPayload { story_id: string }

// ─── Task ────────────────────────────────────────────────────────────────────

export interface TaskCreatedPayload { task_id: string; title: string; project_slug?: string; domain_slug?: string }
export interface TaskQueuedPayload { task_id: string }
export interface TaskStartedPayload { task_id: string; worker_pid: number; worktree_path: string }
export interface TaskCompletedPayload { task_id: string; duration_ms: number; result_summary?: string }
export interface TaskFailedPayload { task_id: string; failure_reason: string; attempt_n: number }
export interface TaskPausedPayload { task_id: string; pause_reason: string }
export interface TaskResumedPayload { task_id: string }
export interface TaskStatusChangedPayload { task_id: string; from_status: string; to_status: string }

// ─── Executor ────────────────────────────────────────────────────────────────

export interface ExecutorStartedPayload { pid: number; max_concurrent: number; poll_interval_ms: number }
export interface ExecutorStoppedPayload { pid: number; reason: string }
export interface ExecutorConfigChangedPayload { fields_changed: string[] }
export interface ExecutorCircuitOpenedPayload { domain_slug: string; failure_count: number; threshold: number }
export interface ExecutorCircuitClosedPayload { domain_slug: string }
export interface ExecutorHeartbeatPayload { pid: number; active_workers: number; queued_tasks: number }

// ─── Worker ──────────────────────────────────────────────────────────────────

export interface WorkerSpawnedPayload { executor_run_id: number; task_id: string; pid: number; worktree_path: string }
export interface WorkerCompletedPayload { executor_run_id: number; task_id: string; exit_code: number; turn_count?: number }
export interface WorkerFailedPayload { executor_run_id: number; task_id: string; exit_code: number; failure_reason: string }
export interface WorkerTimedOutPayload { executor_run_id: number; task_id: string; max_turns: number }

// ─── Behavior test ───────────────────────────────────────────────────────────

export interface BehaviorTestRegisteredPayload { test_id: string; story_id: string; test_path: string }
export interface BehaviorTestPassedPayload { test_id: string; duration_ms: number }
export interface BehaviorTestFailedPayload { test_id: string; failure_message: string; duration_ms: number }

// ─── Completeness ────────────────────────────────────────────────────────────

export interface CompletenessRunStartedPayload { entity_kind: string; entity_id: string; checks_total: number }
export interface CompletenessRunCompletedPayload { run_id: number; score_pct: number; checks_passed: number; checks_total: number }
export interface CompletenessFindingFiledPayload { run_id: number; entity_id: string; finding_code: string; severity: string }

// ─── Backup ──────────────────────────────────────────────────────────────────

export interface BackupStartedPayload { backup_path: string; trigger: string }
export interface BackupCompletedPayload { backup_path: string; size_bytes: number; duration_ms: number }
export interface BackupFailedPayload { backup_path: string; error: string }

// ─── User ────────────────────────────────────────────────────────────────────

export interface UserActionPayload { action: string; entity_type: string; entity_id: string }

// ─── System ──────────────────────────────────────────────────────────────────

export interface SystemStartupPayload { component: string; version: string; port?: number }
export interface SystemShutdownPayload { component: string; reason: string }
export interface SystemErrorPayload { component: string; error: string; stack?: string }

// ─── Domain ──────────────────────────────────────────────────────────────────

export interface DomainCreatedPayload { domain_slug: string; name: string }
export interface DomainUpdatedPayload { domain_slug: string; fields_changed: string[] }

// ─── Lock ────────────────────────────────────────────────────────────────────

export interface LockAcquiredPayload { lock_name: string; holder: string; ttl_ms?: number }
export interface LockReleasedPayload { lock_name: string; holder: string }
export interface LockExpiredPayload { lock_name: string; holder: string }

// ─── Build ───────────────────────────────────────────────────────────────────

export interface BuildStartedPayload { build_run_id: string; trigger: string; git_sha: string; branch: string; changed_files: string[] }
export interface BuildStepStartedPayload { build_run_id: string; build_step_id: string; step_name: string; command: string }
export interface BuildStepCompletedPayload { build_run_id: string; build_step_id: string; step_name: string; exit_code: number; duration_ms: number }
export interface BuildStepFailedPayload { build_run_id: string; build_step_id: string; step_name: string; exit_code: number; stderr_tail: string; error_signature: string }
export interface BuildCompletedPayload { build_run_id: string; outcome: 'success' | 'failure'; duration_ms: number; steps_total: number; steps_failed: number }
export interface BuildAbortedPayload { build_run_id: string; reason: string; completed_steps: number }

// ─── Prompt traceability (migration 0010) ────────────────────────────────────

export interface PromptReceivedPayload { prompt_id: string; received_via: string; session_id?: string; hash: string }
export interface PromptStatusChangedPayload { prompt_id: string; from_status: string; to_status: string; elapsed_ms?: number }

// ─── Event pipeline foundation (migration 0015) ──────────────────────────────

export interface PromptIngestedPayload { promptId: string; text: string; projectId?: string; source: string }
export interface RequirementStateTransitionedPayload { requirementId: string; rootPromptId?: string; fromState: string; toState: string; reason?: string }
export interface ExecutorTaskPickedUpPayload { taskId: string; taskRunId: string; rootPromptId?: string; executorPid: number; worktreePath: string }
export interface ExecutorClaudeToolCallPayload { taskRunId: string; toolName: string; inputSummary?: string; durationMs: number; sequenceIndex: number }
export interface ExecutorClaudeCompletedPayload { taskRunId: string; taskId: string; rootPromptId?: string; exitCode: number; inputTokens: number; outputTokens: number; filesChanged: string[]; toolCallCount: number; durationMs: number }
export interface ExecutorTaskFailedPayload { taskRunId: string; taskId: string; rootPromptId?: string; error: string; retryCount: number; circuitBreakerTripped: boolean }
export interface CompletenessCheckCompletedPayload { taskId: string; taskRunId: string; rootPromptId?: string; passed: boolean; findingCount: number; criticalCount: number; score: number }
export type PipelineStage = 'ingested' | 'requirement_created' | 'story_decomposed' | 'task_queued' | 'task_running' | 'task_completed' | 'verified' | 'requirement_executing' | 'requirement_done';
export interface PipelineStageAdvancedPayload { promptId: string; stage: PipelineStage; entityKind?: string; entityId?: string; durationFromStartMs?: number }

// ─── Priority engine ──────────────────────────────────────────────────────────

export interface PriorityScoredPayload { task_id: string; score: number; bucket: string; rationale_summary: string }
export interface PriorityRebucketedPayload { task_id: string; old_bucket: string; new_bucket: string; score: number }
export interface PriorityReorderedPayload { task_id: string; old_ordinal: number; new_ordinal: number; bucket: string }
export interface PriorityUserOverridePayload { task_id: string; old_ordinal: number; new_ordinal: number; override_reason: string }

// ─── System decisions ─────────────────────────────────────────────────────────

export interface SystemDecisionMadePayload { component: string; decision: string; rationale: string }

// ─── Secrets broker ──────────────────────────────────────────────────────────

export interface SecretFetchedPayload { secret_key_hash: string; caller_module: string; site_slug: string; ttl_sec: number; cached: boolean }
export interface SecretCacheHitPayload { secret_key_hash: string; caller_module: string; site_slug: string; ttl_remaining_sec: number }
export interface SecretRotationTriggeredPayload { secret_key_hash: string; site_slug: string; triggered_by: string }
export interface SecretRotatedPayload { secret_key_hash: string; site_slug: string; duration_ms: number }
export interface SecretAccessDeniedPayload { secret_key_hash: string; caller_ip: string; reason: string }
export interface SecretFetchFailedPayload { secret_key_hash: string; caller_module: string; error: string }

// ─── Pipeline Pulse (migration 0013) ─────────────────────────────────────────

export interface SystemPipelinePulsePayload {
  run_id: string;
  outcome: 'PASSING' | 'DEGRADED' | 'CRITICAL' | 'AUTO-HEALED';
  duration_ms: number;
  checks_total: number;
  checks_passed: number;
  heals_applied: number;
  canary_elapsed_ms: number | null;
}

export interface PulseCanaryDispatchedPayload {
  run_id: string;
  canary_task_id: string;
}

export interface PulseCanaryCompletedPayload {
  run_id: string;
  canary_task_id: string;
  elapsed_ms: number;
  passed: boolean;
}

export interface PulseHealAppliedPayload {
  run_id: string;
  action: string;
  triggered_by: string;
  idempotent: boolean;
}

export interface PulseHealFailedPayload {
  run_id: string;
  action: string;
  triggered_by: string;
  error: string;
}

// ─── Union type of all valid event types ─────────────────────────────────────

export type EventType =
  | 'pipeline.started' | 'pipeline.completed' | 'pipeline.failed'
  | 'pipeline.decompose_started' | 'pipeline.decompose_completed'
  | 'story.created' | 'story.updated' | 'story.status_changed' | 'story.deleted'
  | 'task.created' | 'task.queued' | 'task.started' | 'task.completed'
  | 'task.failed' | 'task.paused' | 'task.resumed' | 'task.status_changed'
  | 'executor.started' | 'executor.stopped' | 'executor.config_changed'
  | 'executor.circuit_opened' | 'executor.circuit_closed' | 'executor.heartbeat'
  | 'worker.spawned' | 'worker.completed' | 'worker.failed' | 'worker.timed_out'
  | 'behavior_test.registered' | 'behavior_test.passed' | 'behavior_test.failed'
  | 'completeness.run_started' | 'completeness.run_completed' | 'completeness.finding_filed'
  | 'backup.started' | 'backup.completed' | 'backup.failed'
  | 'user.action'
  | 'system.startup' | 'system.shutdown' | 'system.error'
  | 'domain.created' | 'domain.updated'
  | 'lock.acquired' | 'lock.released' | 'lock.expired'
  | 'build.started' | 'build.step_started' | 'build.step_completed'
  | 'build.step_failed' | 'build.completed' | 'build.aborted'
  | 'prompt.received' | 'prompt.status_changed'
  | 'priority.scored' | 'priority.rebucketed' | 'priority.reordered' | 'priority.user_override'
  | 'system.decision_made'
  | 'secret.fetched' | 'secret.cache_hit' | 'secret.rotation_triggered'
  | 'secret.rotated' | 'secret.access_denied' | 'secret.fetch_failed'
  | 'system.pipeline_pulse'
  | 'pulse.canary_dispatched' | 'pulse.canary_completed'
  | 'pulse.heal_applied' | 'pulse.heal_failed'
  // ─── Event pipeline foundation (migration 0015) ───
  | 'prompt.ingested'
  | 'requirement.state.transitioned'
  | 'executor.task.picked_up'
  | 'executor.claude.tool_call'
  | 'executor.claude.completed'
  | 'executor.task.failed'
  | 'completeness.check.completed'
  | 'pipeline.stage.advanced'
  // ─── Scaffolder agent events (migration 0017) ─────────────────────────────
  | 'scaffolder.team.assembled';

/** Default severity for each event type */
export const EVENT_SEVERITY: Record<EventType, EventSeverity> = {
  'pipeline.started': 'info', 'pipeline.completed': 'info', 'pipeline.failed': 'error',
  'pipeline.decompose_started': 'info', 'pipeline.decompose_completed': 'info',
  'story.created': 'info', 'story.updated': 'info', 'story.status_changed': 'info', 'story.deleted': 'warning',
  'task.created': 'info', 'task.queued': 'info', 'task.started': 'info', 'task.completed': 'info',
  'task.failed': 'error', 'task.paused': 'warning', 'task.resumed': 'info', 'task.status_changed': 'info',
  'executor.started': 'info', 'executor.stopped': 'info', 'executor.config_changed': 'info',
  'executor.circuit_opened': 'error', 'executor.circuit_closed': 'info', 'executor.heartbeat': 'debug',
  'worker.spawned': 'info', 'worker.completed': 'info', 'worker.failed': 'error', 'worker.timed_out': 'error',
  'behavior_test.registered': 'info', 'behavior_test.passed': 'info', 'behavior_test.failed': 'error',
  'completeness.run_started': 'info', 'completeness.run_completed': 'info', 'completeness.finding_filed': 'warning',
  'backup.started': 'info', 'backup.completed': 'info', 'backup.failed': 'error',
  'user.action': 'info',
  'system.startup': 'info', 'system.shutdown': 'info', 'system.error': 'error',
  'domain.created': 'info', 'domain.updated': 'info',
  'lock.acquired': 'debug', 'lock.released': 'debug', 'lock.expired': 'warning',
  'build.started': 'info', 'build.step_started': 'info', 'build.step_completed': 'info',
  'build.step_failed': 'error', 'build.completed': 'info', 'build.aborted': 'warning',
  'prompt.received': 'info', 'prompt.status_changed': 'info',
  'priority.scored': 'info', 'priority.rebucketed': 'info',
  'priority.reordered': 'info', 'priority.user_override': 'info',
  'system.decision_made': 'info',
  'secret.fetched': 'info',
  'secret.cache_hit': 'debug',
  'secret.rotation_triggered': 'info',
  'secret.rotated': 'info',
  'secret.access_denied': 'warning',
  'secret.fetch_failed': 'error',
  'system.pipeline_pulse': 'info',
  'pulse.canary_dispatched': 'debug',
  'pulse.canary_completed': 'info',
  'pulse.heal_applied': 'warning',
  'pulse.heal_failed': 'error',
  // ─── Event pipeline foundation (migration 0015) ───
  'prompt.ingested': 'info',
  'requirement.state.transitioned': 'info',
  'executor.task.picked_up': 'info',
  'executor.claude.tool_call': 'debug',
  'executor.claude.completed': 'info',
  'executor.task.failed': 'error',
  'completeness.check.completed': 'info',
  'pipeline.stage.advanced': 'info',
  // ─── Scaffolder agent events (migration 0017) ─────────────────────────────
  'scaffolder.team.assembled': 'info',
};

/** All valid event type strings from the registry */
export const ALL_EVENT_TYPES: EventType[] = Object.keys(EVENT_SEVERITY) as EventType[];

export function isValidEventType(t: string): t is EventType {
  return t in EVENT_SEVERITY;
}
