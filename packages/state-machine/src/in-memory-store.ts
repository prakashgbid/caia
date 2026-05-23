import { randomUUID } from 'node:crypto';

import type { ProjectState } from './states.js';
import type {
  StateStore,
  TransitionAtomicInput,
  TransitionAtomicResult,
} from './store.js';
import type {
  ActorKind,
  ClaimResult,
  JanitorResult,
  NewProjectInput,
  ProjectRow,
  StateTransitionRow,
} from './types.js';

interface ClaimRecord {
  ticketId: string;
  projectId: string | null;
  claimedBy: string | null;
  claimedAt: Date | null;
  heartbeatAt: Date | null;
  ttlSeconds: number;
  finalStatus: string | null;
  finalAt: Date | null;
  version: number;
}

interface HistoryRecord extends StateTransitionRow {}

/**
 * In-process StateStore. Maps + arrays only; no SQL.
 *
 * Concurrency model:
 *   - JS is single-threaded; the only contention is between async tasks
 *     that interleave between awaits.
 *   - `transitionAtomic` and `tryClaim` are written as single synchronous
 *     blocks (no `await` between read and write), so they are atomic
 *     within the event loop. Any race in tests that uses `await` between
 *     "read" and "write" can therefore be reproduced reliably without
 *     timing flakes.
 */
export class InMemoryStateStore implements StateStore {
  private projects = new Map<string, ProjectRow>();
  private history: HistoryRecord[] = [];
  private historyNextId = 1;
  private claims = new Map<string, ClaimRecord>();
  private listeners = new Map<string, Set<(payload: string) => void>>();

  async init(): Promise<void> {
    // no-op
  }

  async reset(): Promise<void> {
    this.projects.clear();
    this.history = [];
    this.historyNextId = 1;
    this.claims.clear();
    this.listeners.clear();
  }

  async createProject(input: NewProjectInput): Promise<ProjectRow> {
    const id = input.id ?? randomUUID();
    if (this.projects.has(id)) {
      throw new Error(`project ${id} already exists`);
    }
    const now = new Date();
    const rec: ProjectRow = {
      id,
      tenantId: input.tenantId,
      slug: input.slug,
      displayName: input.displayName,
      status: input.initialState ?? 'onboarding',
      paused: false,
      pausedAt: null,
      pausedBy: null,
      currentPayload: input.initialPayload ?? {},
      lastTransitionedAt: now,
      lastTransitionedBy: 'system',
      parentProjectId: input.parentProjectId ?? null,
      archivedAt: null,
      version: 1,
      createdAt: now,
    };
    this.projects.set(id, rec);
    return cloneProject(rec);
  }

  async getProject(projectId: string): Promise<ProjectRow | null> {
    const rec = this.projects.get(projectId);
    return rec ? cloneProject(rec) : null;
  }

  async listActiveProjects(): Promise<ProjectRow[]> {
    return [...this.projects.values()]
      .filter((p) => p.archivedAt === null)
      .map(cloneProject);
  }

  async setPaused(
    projectId: string,
    paused: boolean,
    by: string | null,
  ): Promise<void> {
    const rec = this.projects.get(projectId);
    if (!rec) return;
    rec.paused = paused;
    if (paused) {
      rec.pausedAt = new Date();
      rec.pausedBy = by;
    } else {
      rec.pausedAt = null;
      rec.pausedBy = null;
    }
  }

  async transitionAtomic(
    input: TransitionAtomicInput,
  ): Promise<TransitionAtomicResult> {
    const rec = this.projects.get(input.projectId);
    if (!rec) return { applied: false, newVersion: 0, historyId: null };

    // Idempotency rule 1: payload-hash unique index.
    const dupByHash = this.history.find(
      (h) =>
        h.projectId === input.projectId &&
        h.toState === input.toState &&
        h.payloadHash === input.payloadHash,
    );
    if (dupByHash) {
      return {
        applied: false,
        newVersion: rec.version,
        historyId: dupByHash.id,
      };
    }

    // Idempotency rule 2: time-window dedupe.
    if (input.idempotencyWindowMs > 0) {
      const cutoff = Date.now() - input.idempotencyWindowMs;
      const dupByWindow = this.history.find(
        (h) =>
          h.projectId === input.projectId &&
          h.toState === input.toState &&
          h.payloadHash === input.payloadHash &&
          h.at.getTime() >= cutoff,
      );
      if (dupByWindow) {
        return {
          applied: false,
          newVersion: rec.version,
          historyId: dupByWindow.id,
        };
      }
    }

    // Optimistic lock.
    if (rec.version !== input.expectedVersion) {
      return { applied: false, newVersion: rec.version, historyId: null };
    }
    if (rec.status !== input.expectedStatus) {
      return { applied: false, newVersion: rec.version, historyId: null };
    }

    // Apply.
    rec.status = input.toState;
    rec.currentPayload = input.payload;
    rec.lastTransitionedAt = new Date();
    rec.lastTransitionedBy = input.actorId;
    rec.version = rec.version + 1;
    if (input.toState === 'archived') rec.archivedAt = new Date();

    const id = this.historyNextId++;
    const histRec: HistoryRecord = {
      id,
      projectId: input.projectId,
      fromState: input.expectedStatus,
      toState: input.toState,
      reason: input.reason,
      actorKind: input.actorKind as ActorKind,
      actorId: input.actorId,
      agentRunId: input.agentRunId,
      payload: input.payload,
      at: rec.lastTransitionedAt,
      payloadHash: input.payloadHash,
    };
    this.history.push(histRec);

    this.fireNotify('caia_project_' + input.projectId, {
      kind: 'state-transition',
      history_id: id,
      from_state: input.expectedStatus,
      to_state: input.toState,
      reason: input.reason,
      actor_kind: input.actorKind,
      actor_id: input.actorId,
      at: histRec.at.toISOString(),
    });

    return { applied: true, newVersion: rec.version, historyId: id };
  }

  async listHistory(
    projectId: string,
    opts: { limit?: number; afterId?: number; toState?: ProjectState } = {},
  ): Promise<StateTransitionRow[]> {
    let rows = this.history.filter((h) => h.projectId === projectId);
    if (opts.afterId !== undefined)
      rows = rows.filter((h) => h.id > (opts.afterId as number));
    if (opts.toState) rows = rows.filter((h) => h.toState === opts.toState);
    rows = rows.slice().sort((a, b) => a.id - b.id);
    if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
    return rows.map(cloneHistory);
  }

  async tryClaim(input: {
    ticketId: string;
    projectId: string | null;
    agentId: string;
    ttlSeconds: number;
    now: Date;
  }): Promise<ClaimResult> {
    const existing = this.claims.get(input.ticketId);
    if (existing && existing.claimedBy && existing.claimedBy !== input.agentId) {
      // Check if the existing claim has expired.
      const last =
        existing.heartbeatAt?.getTime() ?? existing.claimedAt?.getTime() ?? 0;
      const age = (input.now.getTime() - last) / 1000;
      if (age <= existing.ttlSeconds) {
        return { claimed: false, ttl: existing.ttlSeconds };
      }
      // expired - fall through to claim.
    }
    const rec: ClaimRecord = existing ?? {
      ticketId: input.ticketId,
      projectId: input.projectId,
      claimedBy: null,
      claimedAt: null,
      heartbeatAt: null,
      ttlSeconds: input.ttlSeconds,
      finalStatus: null,
      finalAt: null,
      version: 0,
    };
    rec.projectId = input.projectId ?? rec.projectId;
    rec.claimedBy = input.agentId;
    rec.claimedAt = input.now;
    rec.heartbeatAt = input.now;
    rec.ttlSeconds = input.ttlSeconds;
    rec.finalStatus = null;
    rec.finalAt = null;
    rec.version = rec.version + 1;
    this.claims.set(input.ticketId, rec);

    if (rec.projectId) {
      this.fireNotify('caia_ticket_' + rec.projectId, {
        kind: 'ticket-claimed',
        ticket_id: rec.ticketId,
        claimed_by: rec.claimedBy,
        heartbeat_at: rec.heartbeatAt?.toISOString() ?? null,
      });
    }

    return {
      claimed: true,
      ttl: rec.ttlSeconds,
      claimedBy: input.agentId,
      heartbeatAt: input.now,
    };
  }

  async heartbeat(input: {
    ticketId: string;
    agentId: string;
    now: Date;
  }): Promise<{ ok: boolean; heartbeatAt: Date | null }> {
    const rec = this.claims.get(input.ticketId);
    if (!rec || rec.claimedBy !== input.agentId)
      return { ok: false, heartbeatAt: null };
    rec.heartbeatAt = input.now;
    if (rec.projectId) {
      this.fireNotify('caia_ticket_' + rec.projectId, {
        kind: 'ticket-heartbeat',
        ticket_id: rec.ticketId,
        claimed_by: rec.claimedBy,
        heartbeat_at: rec.heartbeatAt?.toISOString() ?? null,
      });
    }
    return { ok: true, heartbeatAt: rec.heartbeatAt };
  }

  async releaseClaim(input: {
    ticketId: string;
    agentId: string;
    finalStatus: string;
    now: Date;
  }): Promise<{ ok: boolean }> {
    const rec = this.claims.get(input.ticketId);
    if (!rec || rec.claimedBy !== input.agentId) return { ok: false };
    rec.claimedBy = null;
    rec.claimedAt = null;
    rec.heartbeatAt = null;
    rec.finalStatus = input.finalStatus;
    rec.finalAt = input.now;
    if (rec.projectId) {
      this.fireNotify('caia_ticket_' + rec.projectId, {
        kind: 'ticket-released',
        ticket_id: rec.ticketId,
        final_status: input.finalStatus,
      });
    }
    return { ok: true };
  }

  async janitorSweep(now: Date): Promise<JanitorResult> {
    const released: string[] = [];
    for (const rec of this.claims.values()) {
      if (!rec.claimedBy || !rec.heartbeatAt) continue;
      const age = (now.getTime() - rec.heartbeatAt.getTime()) / 1000;
      if (age > rec.ttlSeconds) {
        rec.claimedBy = null;
        rec.claimedAt = null;
        rec.heartbeatAt = null;
        rec.finalStatus = 'stale';
        rec.finalAt = now;
        released.push(rec.ticketId);
        if (rec.projectId) {
          this.fireNotify('caia_ticket_' + rec.projectId, {
            kind: 'ticket-released',
            ticket_id: rec.ticketId,
            final_status: 'stale',
          });
        }
      }
    }
    return { releasedClaims: released };
  }

  async subscribe(
    channel: string,
    handler: (payload: string) => void,
  ): Promise<() => Promise<void>> {
    let set = this.listeners.get(channel);
    if (!set) {
      set = new Set();
      this.listeners.set(channel, set);
    }
    set.add(handler);
    return async () => {
      const s = this.listeners.get(channel);
      if (s) s.delete(handler);
    };
  }

  private fireNotify(channel: string, event: Record<string, unknown>): void {
    const set = this.listeners.get(channel);
    if (!set) return;
    const payload = JSON.stringify(event);
    // Iterate over a snapshot to allow handlers to unsubscribe synchronously.
    for (const h of [...set]) {
      try {
        h(payload);
      } catch {
        // never break notify on a misbehaving listener
      }
    }
  }
}

function cloneProject(rec: ProjectRow): ProjectRow {
  return {
    ...rec,
    currentPayload: { ...rec.currentPayload },
  };
}

function cloneHistory(rec: HistoryRecord): StateTransitionRow {
  return {
    ...rec,
    payload: { ...rec.payload },
  };
}
