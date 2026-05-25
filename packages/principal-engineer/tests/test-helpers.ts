/**
 * Shared test helpers — fake StateMachine, fake spawner, ticket factories.
 */

import type {
  ClaimResult,
  ProjectRow,
  ProjectState,
  TransitionResult,
  TriggeredBy,
} from '@caia/state-machine';

import type {
  SchedulerStateMachine,
  SpawnFn,
  Ticket,
} from '../src/types.js';

/** Tiny ticket factory. */
export function mk(
  ticketId: string,
  dependsOn: readonly string[] = [],
  extras: Partial<Pick<Ticket, 'resourceLocks' | 'effort'>> = {},
): Ticket {
  const base: Ticket = { ticketId, dependsOn };
  if (extras.resourceLocks) (base as { resourceLocks?: readonly string[] }).resourceLocks = extras.resourceLocks;
  if (extras.effort !== undefined) (base as { effort?: number }).effort = extras.effort;
  return base;
}

/** In-memory FakeStateMachine implementing the SchedulerStateMachine surface. */
export class FakeStateMachine implements SchedulerStateMachine {
  readonly projects = new Map<string, ProjectRow>();
  readonly transitions: Array<{
    projectId: string;
    toState: ProjectState;
    reason: string;
    triggeredBy: TriggeredBy;
    payload: Record<string, unknown>;
  }> = [];
  readonly claims = new Map<string, string>();
  readonly heartbeats = new Map<string, Date>();
  readonly workerProjects = new Map<string, Set<string>>();
  failTransitions = false;

  ensureProject(id: string, status: ProjectState = 'tests-reviewed'): ProjectRow {
    const existing = this.projects.get(id);
    if (existing) return existing;
    const row: ProjectRow = {
      id,
      tenantId: 't1',
      slug: id,
      displayName: id,
      status,
      paused: false,
      pausedAt: null,
      pausedBy: null,
      currentPayload: {},
      lastTransitionedAt: new Date(0),
      lastTransitionedBy: 'system',
      parentProjectId: null,
      archivedAt: null,
      version: 1,
      createdAt: new Date(0),
    };
    this.projects.set(id, row);
    return row;
  }

  async getProject(projectId: string): Promise<ProjectRow | null> {
    return this.projects.get(projectId) ?? null;
  }
  async currentState(projectId: string): Promise<ProjectState> {
    return this.ensureProject(projectId).status;
  }
  async transition(
    projectId: string,
    toState: ProjectState,
    opts: {
      reason: string;
      triggeredBy: TriggeredBy;
      payload?: Record<string, unknown>;
    },
  ): Promise<TransitionResult> {
    if (this.failTransitions) {
      throw new Error('FakeStateMachine: transition failure injected');
    }
    const proj = this.ensureProject(projectId);
    const from = proj.status;
    proj.status = toState;
    proj.version += 1;
    this.transitions.push({
      projectId,
      toState,
      reason: opts.reason,
      triggeredBy: opts.triggeredBy,
      payload: opts.payload ?? {},
    });
    return {
      applied: true,
      projectId,
      fromState: from,
      toState,
      newVersion: proj.version,
      historyId: this.transitions.length,
      payloadHash: 'fake-hash',
      retries: 0,
    };
  }
  async tryAssignWork(
    projectId: string,
    workerId: string,
    _opts?: { ttlSeconds?: number },
  ): Promise<ClaimResult> {
    const current = this.claims.get(projectId);
    if (current && current !== workerId) {
      return { claimed: false, ttl: 90 };
    }
    this.claims.set(projectId, workerId);
    const set = this.workerProjects.get(workerId) ?? new Set<string>();
    set.add(projectId);
    this.workerProjects.set(workerId, set);
    this.heartbeats.set(workerId, new Date());
    return { claimed: true, ttl: 90, claimedBy: workerId, heartbeatAt: new Date() };
  }
  async recordWorkerHeartbeat(
    workerId: string,
  ): Promise<{ ok: boolean; refreshed: string[] }> {
    this.heartbeats.set(workerId, new Date());
    const set = this.workerProjects.get(workerId);
    return { ok: true, refreshed: set ? Array.from(set) : [] };
  }
  async completeWork(
    workerId: string,
    finalState?: ProjectState,
    opts?: {
      reason?: string;
      triggeredBy?: TriggeredBy;
      payload?: Record<string, unknown>;
    },
  ): Promise<{ released: string[]; transitioned: TransitionResult[] }> {
    const set = this.workerProjects.get(workerId) ?? new Set<string>();
    const released = Array.from(set);
    const transitioned: TransitionResult[] = [];
    for (const pid of released) {
      this.claims.delete(pid);
      if (finalState) {
        const t = await this.transition(pid, finalState, {
          reason: opts?.reason ?? 'completeWork',
          triggeredBy: opts?.triggeredBy ?? { kind: 'agent', id: workerId },
          payload: opts?.payload,
        });
        transitioned.push(t);
      }
    }
    set.clear();
    return { released, transitioned };
  }
  async expireInactiveWorkers(): Promise<{ releasedAssignments: string[] }> {
    return { releasedAssignments: [] };
  }
}

/** Stub SpawnFn that always returns ok=true. */
export function okSpawn(): SpawnFn {
  return async () =>
    Object.freeze({
      ok: true,
      rc: 0,
      stdout: '{"type":"result","result":"ok","is_error":false}',
      stderr: '',
      timedOut: false,
      durationMs: 5,
      diagnostic: null,
      accountId: null,
    });
}

/** Stub SpawnFn that always returns ok=false with a diagnostic. */
export function failingSpawn(diagnostic = 'fake-failure'): SpawnFn {
  return async () =>
    Object.freeze({
      ok: false,
      rc: 1,
      stdout: '',
      stderr: diagnostic,
      timedOut: false,
      durationMs: 5,
      diagnostic,
      accountId: null,
    });
}

/** SpawnFn that records every invocation. */
export function recordingSpawn(): {
  fn: SpawnFn;
  calls: Array<{ prompt: string; options?: unknown }>;
} {
  const calls: Array<{ prompt: string; options?: unknown }> = [];
  const fn: SpawnFn = async (input) => {
    calls.push({
      prompt: input.prompt,
      ...(input.options !== undefined ? { options: input.options } : {}),
    });
    return {
      ok: true,
      rc: 0,
      stdout: '{"type":"result","result":"ok","is_error":false}',
      stderr: '',
      timedOut: false,
      durationMs: 5,
      diagnostic: null,
      accountId: null,
    };
  };
  return { fn, calls };
}

/** System-prompt loader that returns a fixed string. */
export function staticSystemPrompt(content: string): (p: string) => Promise<string> {
  return async () => content;
}
