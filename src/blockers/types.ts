export type BlockerState = 'open' | 'resolved' | 'cancelled';

export type BlockerSeverity = 'critical' | 'high' | 'normal' | 'low';

export type BlockerKind =
  | 'approval'
  | 'credentials'
  | 'dns'
  | 'external-setup'
  | 'info'
  | 'decision';

export interface ResolutionStep {
  order: number;
  instruction: string;
  verification?: string;
}

export interface ApprovalButton {
  label: string;
  payload: unknown;
}

export interface BlockerLink {
  label: string;
  url: string;
}

export interface Blocker {
  id: string;                   // blk_XXXX
  title: string;
  createdAt: string;
  state: BlockerState;
  severity: BlockerSeverity;
  requirementId?: string;
  taskId?: string;
  kind: BlockerKind;
  description: string;
  resolutionSteps: ResolutionStep[];
  approvalButton?: ApprovalButton;
  links?: BlockerLink[];
  resolvedAt?: string;
  resolvedBy?: string;
  resolutionNote?: string;
}

export type BlockerEventType =
  | 'BLOCKER_CREATED'
  | 'BLOCKER_RESOLVED'
  | 'BLOCKER_CANCELLED'
  | 'BLOCKER_SNAPSHOT_REBUILT';

export interface BlockerEvent {
  id: string;
  type: BlockerEventType;
  blockerId: string;
  timestamp: string;
  payload?: unknown;
}

export interface BlockersState {
  blockers: Record<string, Blocker>;
  lastEventId: string;
  rebuiltAt?: string;
}

export interface DrainedBlocker {
  blocker: Blocker;
  approvalPayload?: unknown;
}

export interface BlockerDrainResult {
  resolvedBlockers: DrainedBlocker[];
}

export interface CreateBlockerParams {
  title: string;
  severity: BlockerSeverity;
  kind: BlockerKind;
  description: string;
  resolutionSteps: ResolutionStep[];
  approvalButton?: ApprovalButton;
  links?: BlockerLink[];
  requirementId?: string;
  taskId?: string;
}
