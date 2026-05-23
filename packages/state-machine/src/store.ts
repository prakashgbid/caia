/**
 * The `StateStore` interface is the backend-agnostic storage shape the
 * state-machine depends on. Two implementations ship in this package:
 *
 *   - `InMemoryStateStore` - fast, deterministic, used by ~all unit tests.
 *   - `PgStateStore` - wraps a `pg.Pool`. Used by integration tests and
 *     by orchestrators in production.
 *
 * Every method on this interface MUST be atomic enough that the
 * transition API can compose them without race conditions. Specifically:
 * `transitionAtomic()` must read current state + write history + write
 * project in a single durable step.
 */

import type { ProjectState } from './states.js';
import type {
  ActorKind,
  ClaimResult,
  JanitorResult,
  NewProjectInput,
  ProjectRow,
  StateTransitionRow,
} from './types.js';

export interface TransitionAtomicInput {
  projectId: string;
  expectedVersion: number;
  expectedStatus: ProjectState;
  toState: ProjectState;
  reason: string;
  actorKind: ActorKind;
  actorId: string;
  agentRunId: string | null;
  payload: Record<string, unknown>;
  payloadHash: string;
  /** When non-null, the row is created only if no duplicate exists within this many ms. */
  idempotencyWindowMs: number;
}

export interface TransitionAtomicResult {
  applied: boolean;
  newVersion: number;
  historyId: number | null;
}

export interface StateStore {
  /** Apply migrations (idempotent). Real driver runs the SQL file. */
  init(): Promise<void>;
  /** Test/admin helper - wipes all state. */
  reset?(): Promise<void>;

  createProject(input: NewProjectInput): Promise<ProjectRow>;
  getProject(projectId: string): Promise<ProjectRow | null>;
  listActiveProjects(): Promise<ProjectRow[]>;
  setPaused(
    projectId: string,
    paused: boolean,
    by: string | null,
  ): Promise<void>;

  /**
   * Atomic transition: under a per-project advisory lock + optimistic
   * lock on `version`, update the project row AND append a state_history
   * row in a single commit. Idempotency is enforced via the unique
   * (project_id, to_state, payload_hash) index.
   */
  transitionAtomic(
    input: TransitionAtomicInput,
  ): Promise<TransitionAtomicResult>;

  listHistory(
    projectId: string,
    opts?: { limit?: number; afterId?: number; toState?: ProjectState },
  ): Promise<StateTransitionRow[]>;

  tryClaim(input: {
    ticketId: string;
    projectId: string | null;
    agentId: string;
    ttlSeconds: number;
    now: Date;
  }): Promise<ClaimResult>;

  heartbeat(input: {
    ticketId: string;
    agentId: string;
    now: Date;
  }): Promise<{ ok: boolean; heartbeatAt: Date | null }>;

  releaseClaim(input: {
    ticketId: string;
    agentId: string;
    finalStatus: string;
    now: Date;
  }): Promise<{ ok: boolean }>;

  /** Releases every claim whose heartbeat is older than its ttl. */
  janitorSweep(now: Date): Promise<JanitorResult>;

  subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>>;
}
