export type PhaseStatus =
  | 'pending'
  | 'in_progress'
  | 'done'
  | 'failed'
  | 'blocked';

export interface PhaseDefinition {
  id: number;
  name: string;
  description?: string;
  deps?: number[];
  max_minutes?: number;
  prompt_template?: string;
  success_criteria?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface ChainDefaults {
  max_retries?: number;
  max_minutes?: number;
  heartbeat_interval_sec?: number;
}

export interface ChainSpec {
  defaults?: ChainDefaults;
  phases: PhaseDefinition[];
}

export interface PhaseState {
  status: PhaseStatus;
  attempts: number;
  max_retries: number;
  max_minutes: number;
  started_at: string | null;
  completed_at: string | null;
  session_id: string | null;
  error: string | null;
}

export interface StateFile {
  schema_version: number;
  started_at: string;
  last_wake: string | null;
  paused: boolean;
  budget_consumed_pct: number;
  budget_cap_pct: number;
  phase_status: Record<string, PhaseState>;
  current_phase: number | null;
  all_done: boolean;
}

export interface LockFile {
  phase_id: number;
  session_id: string;
  started_at: string;
  heartbeat: string;
}

export interface AuditEvent {
  ts: string;
  event: string;
  [k: string]: unknown;
}

export interface ChainPaths {
  baseDir: string;
  stateFile: string;
  lockFile: string;
  auditFile: string;
}
