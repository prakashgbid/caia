/**
 * whatsNext - given a project's current state, return the agent type
 * and parameters the orchestrator should fire next.
 *
 * Sourced from `state_machine_handoff_spec_2026.md` §3.1 (handoff
 * table). Each non-terminal "doing" state has a producer agent; that
 * agent runs, produces the next state's payload, and the orchestrator
 * transitions the project on success.
 *
 * Idempotent: calling whatsNext twice in a row returns the same answer.
 * After a successful transition, calling it again returns the next
 * step (because the project's `status` has advanced).
 */

import { ProjectNotFoundError } from './errors.js';
import { isFailedState, isHappyState, type ProjectState } from './states.js';
import type { StateMachine } from './state-machine.js';

export interface AgentSpec {
  /** The agent identifier the orchestrator looks up in `claude-spawner`. */
  type: string;
  /** Artifact name the agent should produce (from handoff-contracts §3.1). */
  producesArtifact: string;
  /** The state to transition the project to on success. */
  onSuccessTransitionTo: ProjectState;
  /** State to transition to on failure. */
  onFailureTransitionTo: ProjectState;
}

export type WaitingReason =
  | 'project-paused'
  | 'project-archived'
  | 'project-done'
  | 'waiting-for-operator'
  | 'waiting-for-external'
  | 'waiting-for-failure-recovery'
  | 'waiting-for-revision-router'
  | 'unknown';

export interface WhatsNextResult {
  hasWork: boolean;
  currentState: ProjectState;
  agent: AgentSpec | null;
  parameters: Record<string, unknown>;
  waitingOn: WaitingReason | null;
}

type HandoffEntry = AgentSpec | { waitingOn: WaitingReason };

const HANDOFF_TABLE: Record<ProjectState, HandoffEntry> = {
  // -- Happy path producers --
  onboarding: {
    type: '@caia/onboarding',
    producesArtifact: 'OnboardedTenant',
    onSuccessTransitionTo: 'idea-captured',
    onFailureTransitionTo: 'onboarding-failed',
  },
  'idea-captured': {
    type: '@caia/idea-capture',
    producesArtifact: 'GrandIdeaBrief',
    onSuccessTransitionTo: 'interviewing',
    onFailureTransitionTo: 'interviewing-failed',
  },
  interviewing: {
    type: '@caia/interviewer',
    producesArtifact: 'BusinessPlan',
    onSuccessTransitionTo: 'interview-complete',
    onFailureTransitionTo: 'interviewing-failed',
  },
  'interview-complete': {
    type: '@caia/proposal-generator',
    producesArtifact: 'ProposalBundle',
    onSuccessTransitionTo: 'proposal-generated',
    onFailureTransitionTo: 'proposal-failed',
  },
  'proposal-generated': {
    type: '@caia/proposal-emit',
    producesArtifact: 'DesignAppPrompt',
    onSuccessTransitionTo: 'awaiting-external-design',
    onFailureTransitionTo: 'proposal-failed',
  },
  'awaiting-external-design': { waitingOn: 'waiting-for-external' },
  'design-uploaded': {
    type: '@caia/design-normalizer',
    producesArtifact: 'RenderableDesign',
    onSuccessTransitionTo: 'ticket-tree-generated',
    onFailureTransitionTo: 'design-ingest-failed',
  },
  'ticket-tree-generated': {
    type: '@caia/principal-po',
    producesArtifact: 'AtlasBundle',
    onSuccessTransitionTo: 'atlas-ready',
    onFailureTransitionTo: 'atlas-decompose-failed',
  },
  'atlas-ready': { waitingOn: 'waiting-for-operator' },
  'change-requested': {
    type: '@caia/atlas-change-router',
    producesArtifact: 'ResumeDirective',
    onSuccessTransitionTo: 'revision-pending',
    onFailureTransitionTo: 'atlas-decompose-failed',
  },
  'revision-pending': { waitingOn: 'waiting-for-revision-router' },
  'ea-dispatching': {
    type: '@caia/ea-dispatcher',
    producesArtifact: 'ArchitectureBundle',
    onSuccessTransitionTo: 'ea-complete',
    onFailureTransitionTo: 'ea-dispatching-failed',
  },
  'ea-complete': {
    type: '@caia/ea-reviewer',
    producesArtifact: 'EAReviewedBundle',
    onSuccessTransitionTo: 'tests-authored',
    onFailureTransitionTo: 'ea-review-failed',
  },
  'tests-authored': {
    type: '@caia/test-reviewer',
    producesArtifact: 'TestCasesBundle',
    onSuccessTransitionTo: 'tests-reviewed',
    onFailureTransitionTo: 'tests-review-failed',
  },
  'tests-reviewed': {
    type: '@caia/sps-adapter',
    producesArtifact: 'SchedulableTree',
    onSuccessTransitionTo: 'scheduled',
    onFailureTransitionTo: 'scheduling-failed',
  },
  scheduled: {
    type: '@caia/coding-worker',
    producesArtifact: 'CodingResultSet',
    onSuccessTransitionTo: 'coding-in-progress',
    onFailureTransitionTo: 'coding-failed',
  },
  'coding-in-progress': {
    type: '@caia/coding-worker',
    producesArtifact: 'CodingResultSet',
    onSuccessTransitionTo: 'code-complete',
    onFailureTransitionTo: 'coding-failed',
  },
  'code-complete': {
    type: '@caia/per-story-tester',
    producesArtifact: 'StoryTestReport',
    onSuccessTransitionTo: 'per-story-tested',
    onFailureTransitionTo: 'per-story-test-failed',
  },
  'per-story-tested': {
    type: '@caia/e2e-runner',
    producesArtifact: 'E2EReport',
    onSuccessTransitionTo: 'e2e-tested',
    onFailureTransitionTo: 'e2e-failed',
  },
  'e2e-tested': {
    type: '@caia/deploy-orchestrator',
    producesArtifact: 'DeployPlan',
    onSuccessTransitionTo: 'deploying',
    onFailureTransitionTo: 'deploy-failed',
  },
  deploying: {
    type: '@caia/deploy-orchestrator',
    producesArtifact: 'DeployRecord',
    onSuccessTransitionTo: 'deployed',
    onFailureTransitionTo: 'deploy-failed',
  },
  deployed: {
    type: '@caia/verifier',
    producesArtifact: 'VerificationReport',
    onSuccessTransitionTo: 'verified',
    onFailureTransitionTo: 'verify-failed',
  },
  verified: {
    type: '@caia/done-emitter',
    producesArtifact: 'DoneReceipt',
    onSuccessTransitionTo: 'done',
    onFailureTransitionTo: 'verify-failed',
  },

  // -- Failed-side: wait for operator / auto-retry --
  'onboarding-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'interviewing-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'proposal-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'design-ingest-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'atlas-decompose-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'ea-dispatching-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'ea-review-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'tests-authoring-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'tests-review-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'scheduling-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'coding-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'per-story-test-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'e2e-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'deploy-failed': { waitingOn: 'waiting-for-failure-recovery' },
  'verify-failed': { waitingOn: 'waiting-for-failure-recovery' },

  // -- Control --
  paused: { waitingOn: 'project-paused' },
  archived: { waitingOn: 'project-archived' },
  done: { waitingOn: 'project-done' },
};

export async function whatsNext(
  sm: StateMachine,
  projectId: string,
): Promise<WhatsNextResult> {
  const proj = await sm.getProject(projectId);
  if (!proj) throw new ProjectNotFoundError(projectId);
  if (proj.paused) {
    return {
      hasWork: false,
      currentState: proj.status,
      agent: null,
      parameters: { project_id: projectId },
      waitingOn: 'project-paused',
    };
  }
  if (proj.archivedAt) {
    return {
      hasWork: false,
      currentState: proj.status,
      agent: null,
      parameters: { project_id: projectId },
      waitingOn: 'project-archived',
    };
  }
  const entry = HANDOFF_TABLE[proj.status];
  if ('waitingOn' in entry) {
    return {
      hasWork: false,
      currentState: proj.status,
      agent: null,
      parameters: { project_id: projectId },
      waitingOn: entry.waitingOn,
    };
  }
  return {
    hasWork: true,
    currentState: proj.status,
    agent: entry,
    parameters: {
      project_id: projectId,
      tenant_id: proj.tenantId,
      input_payload: proj.currentPayload,
      version: proj.version,
    },
    waitingOn: null,
  };
}

export interface ResumePoint {
  state: ProjectState;
  reason: 'steady-state' | 'history-replayed' | 'parked-at-failure' | 'paused';
  lastHistoryId: number | null;
}

export async function resumePoint(
  sm: StateMachine,
  projectId: string,
): Promise<ResumePoint> {
  const proj = await sm.getProject(projectId);
  if (!proj) throw new ProjectNotFoundError(projectId);
  if (proj.paused) {
    return { state: proj.status, reason: 'paused', lastHistoryId: null };
  }
  if (isFailedState(proj.status)) {
    const hist = await sm.replayHistory(projectId, {
      limit: 1,
      toState: proj.status,
    });
    return {
      state: proj.status,
      reason: 'parked-at-failure',
      lastHistoryId: hist[0]?.id ?? null,
    };
  }
  const all = await sm.replayHistory(projectId);
  const last = all[all.length - 1];
  if (last && last.toState !== proj.status && isHappyState(proj.status)) {
    return {
      state: proj.status,
      reason: 'history-replayed',
      lastHistoryId: last.id,
    };
  }
  return {
    state: proj.status,
    reason: 'steady-state',
    lastHistoryId: last?.id ?? null,
  };
}
