import type { ProjectState } from './states.js';

/** Actor-kind for the audit log. */
export type ActorKind = 'system' | 'operator' | 'agent';

export interface TriggeredBy {
  kind: ActorKind;
  /** Agent id, operator user id, or 'system'. */
  id: string;
  /** Optional pointer to an agent_runs row. */
  agentRunId?: string;
}

export interface StateTransitionRow {
  id: number;
  projectId: string;
  fromState: ProjectState | null;
  toState: ProjectState;
  reason: string;
  actorKind: ActorKind;
  actorId: string;
  agentRunId: string | null;
  payload: Record<string, unknown>;
  at: Date;
  payloadHash: string;
}

export interface ProjectRow {
  id: string;
  tenantId: string;
  slug: string;
  displayName: string;
  status: ProjectState;
  paused: boolean;
  pausedAt: Date | null;
  pausedBy: string | null;
  currentPayload: Record<string, unknown>;
  lastTransitionedAt: Date;
  lastTransitionedBy: string;
  parentProjectId: string | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
}

export interface TransitionOpts {
  reason: string;
  triggeredBy: TriggeredBy;
  payload?: Record<string, unknown>;
  /**
   * When set, the transition is only applied if the current project
   * version matches. Without this the API does a read-then-write inside
   * its own transaction; provide it when the caller already has a
   * snapshot they want to commit against.
   */
  expectedVersion?: number;
  /**
   * Override per-call retry budget. Defaults to `StateMachineOptions.defaultRetries`.
   */
  retries?: number;
}

export interface TransitionResult {
  /** True if this call actually moved state; false on idempotent no-op. */
  applied: boolean;
  projectId: string;
  fromState: ProjectState;
  toState: ProjectState;
  newVersion: number;
  historyId: number | null;
  payloadHash: string;
  /** Number of optimistic-lock retries before the call resolved. */
  retries: number;
}

export interface ClaimResult {
  claimed: boolean;
  /** Seconds until the claim is considered stale (and the janitor may revoke it). */
  ttl: number;
  claimedBy?: string;
  heartbeatAt?: Date;
}

export interface JanitorResult {
  releasedClaims: string[];
}

export interface NewProjectInput {
  id?: string;
  tenantId: string;
  slug: string;
  displayName: string;
  initialState?: ProjectState;
  initialPayload?: Record<string, unknown>;
  parentProjectId?: string;
}

export interface StateMachineOptions {
  /** Clock for tests. */
  now?: () => Date;
  /**
   * Time window inside which an immediate duplicate transition call is
   * a no-op. The payload-hash idempotency rule is always enforced; this
   * is a softer rule for catching duplicate clicks with empty payloads.
   * Defaults to 1000ms.
   */
  idempotencyWindowMs?: number;
  /** Default number of optimistic-lock retries for `transition()`. Defaults to 3. */
  defaultRetries?: number;
  /** Worker claim TTL in seconds. Defaults to 90 (matches spec §4.3). */
  workerTtlSeconds?: number;
}
