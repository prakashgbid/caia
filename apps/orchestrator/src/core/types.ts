export type TaskStatus = 'queued' | 'running' | 'blocked' | 'completed' | 'failed' | 'cancelled';
export type SpawnedBy = 'claude' | 'user' | 'hook';

export interface Task {
  id: string;
  title: string;
  sessionId?: string;
  status: TaskStatus;
  cwd: string;
  declaredFiles: string[];
  actualFiles?: string[];
  dependsOn: string[];
  blockedBy?: string[];
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  spawnedBy: SpawnedBy;
  bypassUsed?: boolean;
  notes?: string;
}

export type EventType =
  | 'TASK_ADDED'
  | 'TASK_STARTED'
  | 'TASK_COMPLETED'
  | 'TASK_FAILED'
  | 'TASK_CANCELLED'
  | 'TASK_BLOCKED'
  | 'TASK_UNBLOCKED'
  | 'TASK_TTL_EXPIRED'
  | 'LOCK_RELEASED'
  | 'BYPASS_LOGGED'
  | 'DEGRADED_SPAWN'
  | 'RECONCILE_DRIFT'
  | 'SNAPSHOT_REBUILT';

export interface ConductorEvent {
  id: string;
  type: EventType;
  taskId?: string;
  timestamp: string;
  payload?: unknown;
}

export interface ConductorState {
  tasks: Record<string, Task>;
  events: ConductorEvent[];
  lastEventId: string;
  rebuiltAt?: string;
}

export interface ConflictInfo {
  file: string;
  matchedGlob: string;
  taskId: string;
  taskTitle: string;
  taskStatus: TaskStatus;
}

export interface CheckResult {
  clean: boolean;
  conflicts: ConflictInfo[];
}

export interface AddParams {
  title: string;
  cwd: string;
  files: string[];
  dependsOn?: string[];
  spawnedBy?: SpawnedBy;
  notes?: string;
}

export interface AddResult {
  id: string;
  status: TaskStatus;
  conflicts: ConflictInfo[];
  blockedBy?: string[];
}

export interface AuditResult {
  taskId: string;
  declared: string[];
  actual: string[];
  missing: string[];
  extra: string[];
  clean: boolean;
}
