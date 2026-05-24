import { randomUUID } from 'node:crypto';

import { DuplicateSolutionIdError } from './solution-errors.js';
import {
  isSolutionTerminal,
  SOLUTION_INITIAL_STATE,
  type SolutionState,
} from './solution-states.js';
import type {
  SolutionAdvanceAtomicInput,
  SolutionAdvanceAtomicResult,
  SolutionStore,
  ListStuckOpts,
} from './solution-store.js';
import type {
  ApprovedPlanInput,
  SolutionActorKind,
  SolutionHistoryRow,
  SolutionRow,
  StuckSolution,
} from './solution-types.js';
import {
  availableSolutionTransitions,
  VALID_SOLUTION_TRANSITIONS,
} from './solution-transitions.js';

/**
 * In-memory `SolutionStore` — same concurrency model as the project
 * FSM's `InMemoryStateStore`: every `advanceAtomic` runs as a single
 * synchronous block (no awaits between the read and write), so the
 * advisory-lock + optimistic-version protocol is satisfied by JS's
 * single-threaded event loop. Tests can reproduce multi-writer races
 * deterministically by interleaving `await`s between calls.
 */
export class InMemorySolutionStore implements SolutionStore {
  private solutions = new Map<string, SolutionRow>();
  private history: SolutionHistoryRow[] = [];
  private historyNextId = 1;
  private listeners = new Map<string, Set<(payload: string) => void>>();

  async init(): Promise<void> {
    // no-op
  }

  async reset(): Promise<void> {
    this.solutions.clear();
    this.history = [];
    this.historyNextId = 1;
    this.listeners.clear();
  }

  async registerSolution(input: ApprovedPlanInput, now: Date): Promise<SolutionRow> {
    const solutionId = input.solutionId ?? defaultSolutionId(now);
    if (this.solutions.has(solutionId)) {
      throw new DuplicateSolutionIdError(solutionId);
    }
    const approvedAt = input.approvedAt ? new Date(input.approvedAt) : now;
    const initialState = input.initialState ?? SOLUTION_INITIAL_STATE;
    const row: SolutionRow = {
      id: randomUUID(),
      solutionId,
      title: input.title,
      planPath: input.planPath ?? null,
      approvedByAdr: input.approvedByAdr ?? null,
      approvedAt,
      status: initialState,
      statusSince: now,
      paused: false,
      pausedAt: null,
      pausedBy: null,
      priorState: null,
      currentPayload: input.initialPayload ?? {},
      lastAttestation: {},
      manifestPointer: input.manifestPointer ?? null,
      abandonedAt: null,
      doneAt: null,
      version: 1,
      createdAt: now,
    };
    this.solutions.set(solutionId, row);
    return cloneSolution(row);
  }

  async getSolution(solutionId: string): Promise<SolutionRow | null> {
    const rec = this.solutions.get(solutionId);
    return rec ? cloneSolution(rec) : null;
  }

  async listActiveSolutions(): Promise<SolutionRow[]> {
    return [...this.solutions.values()]
      .filter((s) => s.abandonedAt === null && s.doneAt === null)
      .map(cloneSolution);
  }

  async setPaused(
    solutionId: string,
    by: string,
    now: Date,
  ): Promise<SolutionRow | null> {
    const rec = this.solutions.get(solutionId);
    if (!rec) return null;
    if (rec.paused) return cloneSolution(rec); // idempotent
    if (isSolutionTerminal(rec.status)) return cloneSolution(rec); // can't pause terminal
    rec.priorState = rec.status;
    rec.status = 'paused';
    rec.statusSince = now;
    rec.paused = true;
    rec.pausedAt = now;
    rec.pausedBy = by;
    rec.version += 1;
    return cloneSolution(rec);
  }

  async setResumed(solutionId: string, now: Date): Promise<SolutionRow | null> {
    const rec = this.solutions.get(solutionId);
    if (!rec) return null;
    if (!rec.paused) return cloneSolution(rec); // idempotent
    const prior = rec.priorState;
    if (prior !== null) {
      rec.status = prior;
    }
    rec.statusSince = now;
    rec.paused = false;
    rec.pausedAt = null;
    rec.pausedBy = null;
    rec.priorState = null;
    rec.version += 1;
    return cloneSolution(rec);
  }

  async advanceAtomic(
    input: SolutionAdvanceAtomicInput,
  ): Promise<SolutionAdvanceAtomicResult> {
    const rec = this.solutions.get(input.solutionId);
    if (!rec) {
      return { applied: false, newVersion: 0, historyId: null, idempotentReplay: false };
    }

    // Idempotency rule 1: payload-hash unique by (solution_id, to_state, payload_hash).
    const dupByHash = this.history.find(
      (h) =>
        h.solutionId === input.solutionId &&
        h.toState === input.toState &&
        h.payloadHash === input.payloadHash,
    );
    if (dupByHash) {
      return {
        applied: false,
        newVersion: rec.version,
        historyId: dupByHash.id,
        idempotentReplay: true,
      };
    }

    // Idempotency rule 2: time-window dedupe for empty-payload click-storms.
    if (input.idempotencyWindowMs > 0) {
      const cutoff = Date.now() - input.idempotencyWindowMs;
      const dupByWindow = this.history.find(
        (h) =>
          h.solutionId === input.solutionId &&
          h.toState === input.toState &&
          h.payloadHash === input.payloadHash &&
          h.at.getTime() >= cutoff,
      );
      if (dupByWindow) {
        return {
          applied: false,
          newVersion: rec.version,
          historyId: dupByWindow.id,
          idempotentReplay: true,
        };
      }
    }

    // Optimistic lock + status check.
    if (rec.version !== input.expectedVersion) {
      return { applied: false, newVersion: rec.version, historyId: null, idempotentReplay: false };
    }
    if (rec.status !== input.expectedStatus) {
      return { applied: false, newVersion: rec.version, historyId: null, idempotentReplay: false };
    }

    // Apply.
    const fromState = rec.status;
    rec.status = input.toState;
    const transitionAt = input.now;
    rec.statusSince = transitionAt;
    rec.currentPayload = input.payload;
    rec.lastAttestation = input.attestation;
    rec.version += 1;
    if (input.toState === 'abandoned') {
      rec.abandonedAt = transitionAt;
    } else if (input.toState === 'done') {
      rec.doneAt = transitionAt;
    }

    const id = this.historyNextId++;
    const histRow: SolutionHistoryRow = {
      id,
      solutionId: input.solutionId,
      fromState,
      toState: input.toState,
      reason: input.reason,
      actorKind: input.actorKind as SolutionActorKind,
      actorId: input.actorId,
      attestation: input.attestation,
      evidence: input.evidence,
      payload: input.payload,
      payloadHash: input.payloadHash,
      at: transitionAt,
    };
    this.history.push(histRow);

    this.fireNotify('caia_solution_' + input.solutionId, {
      kind: 'solution-advanced',
      history_id: id,
      from_state: fromState,
      to_state: input.toState,
      reason: input.reason,
      actor_kind: input.actorKind,
      actor_id: input.actorId,
      at: transitionAt.toISOString(),
    });

    return {
      applied: true,
      newVersion: rec.version,
      historyId: id,
      idempotentReplay: false,
    };
  }

  async listHistory(
    solutionId: string,
    opts: { limit?: number; afterId?: number; toState?: SolutionState } = {},
  ): Promise<SolutionHistoryRow[]> {
    let rows = this.history.filter((h) => h.solutionId === solutionId);
    if (opts.afterId !== undefined) {
      const after = opts.afterId;
      rows = rows.filter((h) => h.id > after);
    }
    if (opts.toState) {
      const toState = opts.toState;
      rows = rows.filter((h) => h.toState === toState);
    }
    rows = rows.slice().sort((a, b) => a.id - b.id);
    if (opts.limit !== undefined) rows = rows.slice(0, opts.limit);
    return rows.map(cloneHistory);
  }

  async listStuck(opts: ListStuckOpts): Promise<StuckSolution[]> {
    const out: StuckSolution[] = [];
    const nowMs = opts.now.getTime();
    for (const rec of this.solutions.values()) {
      if (rec.paused) continue;
      if (isSolutionTerminal(rec.status)) continue;
      const threshold = opts.thresholdsHours[rec.status];
      if (threshold === undefined) continue;
      const ageHours = (nowMs - rec.statusSince.getTime()) / 3_600_000;
      if (ageHours >= threshold) {
        out.push({
          solution: cloneSolution(rec),
          ageHoursInState: ageHours,
          thresholdHours: threshold,
          nextExpectedState: deriveNextExpected(rec.status),
        });
      }
    }
    return out.sort(
      (a, b) =>
        b.ageHoursInState - b.thresholdHours - (a.ageHoursInState - a.thresholdHours),
    );
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
      if (s) {
        s.delete(handler);
        if (s.size === 0) this.listeners.delete(channel);
      }
    };
  }

  private fireNotify(channel: string, event: Record<string, unknown>): void {
    const set = this.listeners.get(channel);
    if (!set) return;
    const payload = JSON.stringify(event);
    for (const h of [...set]) {
      try {
        h(payload);
      } catch {
        /* swallow listener errors */
      }
    }
  }
}

function cloneSolution(rec: SolutionRow): SolutionRow {
  return {
    ...rec,
    currentPayload: { ...rec.currentPayload },
    lastAttestation: { ...rec.lastAttestation },
  };
}

function cloneHistory(rec: SolutionHistoryRow): SolutionHistoryRow {
  return {
    ...rec,
    payload: { ...rec.payload },
    attestation: { ...rec.attestation },
    evidence: { ...rec.evidence },
  };
}

function defaultSolutionId(now: Date): string {
  // canonical caia-YYYY-MM-DD-<random6> shape
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(now.getUTCDate()).padStart(2, '0');
  const rand = Math.random().toString(36).slice(2, 8);
  return `caia-${yyyy}-${mm}-${dd}-${rand}`;
}

/** Compute the conductor's expected next forward state. Uses the first
 * non-failure, non-rolled-back edge from the transition table — which by
 * construction (see `solution-transitions.ts`) is the next forward
 * state in `SOLUTION_FORWARD_STATES`. */
function deriveNextExpected(current: SolutionState): SolutionState | null {
  const edges = availableSolutionTransitions(current);
  // First edge added by `buildTransitionTable` for forward states is the
  // next forward state — preserve that contract via lookup.
  const matrix = VALID_SOLUTION_TRANSITIONS[current];
  if (matrix.length === 0) return null;
  for (const candidate of edges) {
    if (
      candidate !== 'paused' &&
      candidate !== 'abandoned' &&
      !candidate.endsWith('-failed') &&
      !candidate.endsWith('-rolled-back')
    ) {
      return candidate;
    }
  }
  return null;
}
