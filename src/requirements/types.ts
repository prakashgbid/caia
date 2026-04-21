export type RequirementState =
  | 'captured'
  | 'refining'
  | 'specced'
  | 'ready'
  | 'executing'
  | 'verifying'
  | 'done'
  | 'blocked'
  | 'cancelled';

export type NotificationKind = 'started' | 'progress' | 'completed' | 'blocked';
export type NotificationChannel = 'chat' | 'native' | 'both';

export interface RequirementSpec {
  goals: string[];
  nonGoals: string[];
  acceptanceCriteria: string[];
  notes: string;
}

export interface RequirementNote {
  ts: string;
  text: string;
}

export interface NotificationRecord {
  ts: string;
  kind: NotificationKind;
  channel: NotificationChannel;
}

export interface Requirement {
  id: string;               // req_XXXX
  title: string;
  description: string;
  capturedAt: string;
  updatedAt: string;
  state: RequirementState;
  priority: 1 | 2 | 3 | 4 | 5;
  labels: string[];
  dependsOn: string[];      // other requirement IDs
  targetProject?: string;
  estimatedFiles: string[]; // glob patterns
  spec?: RequirementSpec;
  linkedTaskIds: string[];  // conductor task IDs spawned from this
  notes: RequirementNote[];
  notificationsSent: NotificationRecord[];
  // Set by prioritization engine (migration 0012)
  priorityBucket?: string;
  positionOrdinal?: number;
}

export type RequirementEventType =
  | 'REQ_CAPTURED'
  | 'REQ_UPDATED'
  | 'REQ_STATE_CHANGED'
  | 'REQ_DEP_ADDED'
  | 'REQ_TASK_LINKED'
  | 'REQ_NOTE_ADDED'
  | 'REQ_SNAPSHOT_REBUILT';

export interface RequirementEvent {
  id: string;
  type: RequirementEventType;
  reqId: string;
  timestamp: string;
  payload?: unknown;
}

export interface RequirementsState {
  requirements: Record<string, Requirement>;
  lastEventId: string;
  rebuiltAt?: string;
}

export interface PumpTickResult {
  picked: Requirement | null;
  prompt: string | null;
  cwd: string | null;
}

export interface ListRequirementsFilter {
  state?: RequirementState;
  priority?: 1 | 2 | 3 | 4 | 5;
  labels?: string[];
}
