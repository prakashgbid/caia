/**
 * @caia/pipeline-conductor — public types.
 * Sourced from research/conductor_agent_spec_2026.md §6.1.
 */

import type { ProjectState } from '@caia/state-machine';

export type StageName =
  | 'onboarding'
  | 'idea-captured'
  | 'interviewing'
  | 'interview-complete'
  | 'proposal-generated'
  | 'awaiting-external-design'
  | 'design-uploaded'
  | 'ticket-tree-generated'
  | 'atlas-ready'
  | 'ea-dispatching'
  | 'ea-complete'
  | 'tests-authored'
  | 'tests-reviewed'
  | 'scheduled'
  | 'coding-in-progress'
  | 'code-complete'
  | 'per-story-tested'
  | 'e2e-tested'
  | 'deploying'
  | 'deployed'
  | 'verified';

export const STAGE_NAMES: readonly StageName[] = [
  'onboarding',
  'idea-captured',
  'interviewing',
  'interview-complete',
  'proposal-generated',
  'awaiting-external-design',
  'design-uploaded',
  'ticket-tree-generated',
  'atlas-ready',
  'ea-dispatching',
  'ea-complete',
  'tests-authored',
  'tests-reviewed',
  'scheduled',
  'coding-in-progress',
  'code-complete',
  'per-story-tested',
  'e2e-tested',
  'deploying',
  'deployed',
  'verified',
] as const;

export function isStageName(value: unknown): value is StageName {
  return typeof value === 'string' && (STAGE_NAMES as readonly string[]).includes(value);
}

export interface AgentActivity {
  agentRunId: string;
  agent: string;
  claimedAt: string;
  heartbeatAt: string;
  secondsSinceHeartbeat: number;
}

export interface OpenEscalation {
  id: string;
  stage: StageName;
  reason: string;
  thresholdSeconds: number;
  elapsedSeconds: number;
  openedAt: string;
  notes: string | null;
}

export interface StateTransition {
  fromState: ProjectState | null;
  toState: ProjectState;
  reason: string;
  actorKind: 'system' | 'operator' | 'agent';
  actorId: string;
  at: string;
}

export interface FailureEvent {
  at: string;
  stage: StageName;
  errorMessage: string;
  agent: string;
}

export interface ProjectForecast {
  p50At: string | null;
  p90At: string | null;
  sampleSize: number;
  source: 'tenant-stat' | 'platform-fallback' | 'insufficient-data';
}

export interface OperatorProjectStatus {
  projectId: string;
  tenantId: string;
  slug: string;
  displayName: string;
  status: ProjectState;
  paused: boolean;
  pausedSince: string | null;
  currentStage: StageName | null;
  currentStageEnteredAt: string;
  secondsInState: number;
  activeAgents: AgentActivity[];
  forecast: ProjectForecast;
  escalations: OpenEscalation[];
  recentTransitions: StateTransition[];
  recentFailures: FailureEvent[];
  bottleneckIndicators: { stage: StageName; severity: 'info' | 'warn' | 'critical' }[];
  refreshedAt: string;
}

export interface StuckProject {
  projectId: string;
  tenantId: string;
  slug: string;
  status: ProjectState;
  currentStage: StageName | null;
  secondsInState: number;
  lastHeartbeatAt: string | null;
  openEscalations: number;
}

export interface StageHistoryEntry {
  stage: StageName | string;
  enteredAt: string;
  exitedAt: string | null;
  durationSeconds: number | null;
  exitReason: 'succeeded' | 'failed-recovered' | 'abandoned' | null;
  retryCount: number;
}

export interface StageHealth {
  count: number;
  p50DwellSec: number;
  p90DwellSec: number;
  stuck: number;
}

export interface PipelineHealth {
  activeProjects: number;
  byStage: Record<string, StageHealth>;
  openEscalations: number;
  recentFailures: number;
  bottlenecks: { stage: StageName | string; severity: 'info' | 'warn' | 'critical' }[];
  lastDeployAt: string | null;
  computedAt: string;
}

export type EscalationResolution =
  | 'resumed'
  | 'completed'
  | 'abandoned'
  | 'escalated-to-operator';

export interface EscalationResult {
  escalationId: string;
  alreadyOpen: boolean;
}
