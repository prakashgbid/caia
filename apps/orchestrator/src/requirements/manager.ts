import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import { assertTransition } from './state-machine';
import { eventBus } from '../events/bus-adapter';
import { getDb } from '../db/connection';
import { timelineEvents } from '../db/schema';
import type {
  ListRequirementsFilter,
  Requirement,
  RequirementEvent,
  RequirementEventType,
  RequirementNote,
  RequirementSpec,
  RequirementState,
  RequirementsState,
} from './types';

function applyEvent(state: RequirementsState, event: RequirementEvent): RequirementsState {
  const reqs = { ...state.requirements };
  const { reqId } = event;

  switch (event.type) {
    case 'REQ_CAPTURED': {
      const payload = event.payload as { req: Requirement } | undefined;
      if (payload?.req) {
        reqs[reqId] = { ...payload.req };
      }
      break;
    }
    case 'REQ_UPDATED': {
      const payload = event.payload as Partial<Requirement> | undefined;
      if (reqs[reqId] && payload) {
        reqs[reqId] = { ...reqs[reqId]!, ...payload, id: reqId, updatedAt: event.timestamp };
      }
      break;
    }
    case 'REQ_STATE_CHANGED': {
      const payload = event.payload as { state: RequirementState } | undefined;
      if (reqs[reqId] && payload) {
        reqs[reqId] = { ...reqs[reqId]!, state: payload.state, updatedAt: event.timestamp };
      }
      break;
    }
    case 'REQ_DEP_ADDED': {
      const payload = event.payload as { dependsOnId: string } | undefined;
      if (reqs[reqId] && payload) {
        const existing = reqs[reqId]!.dependsOn;
        if (!existing.includes(payload.dependsOnId)) {
          reqs[reqId] = {
            ...reqs[reqId]!,
            dependsOn: [...existing, payload.dependsOnId],
            updatedAt: event.timestamp,
          };
        }
      }
      break;
    }
    case 'REQ_TASK_LINKED': {
      const payload = event.payload as { taskId: string } | undefined;
      if (reqs[reqId] && payload) {
        const existing = reqs[reqId]!.linkedTaskIds;
        if (!existing.includes(payload.taskId)) {
          reqs[reqId] = {
            ...reqs[reqId]!,
            linkedTaskIds: [...existing, payload.taskId],
            updatedAt: event.timestamp,
          };
        }
      }
      break;
    }
    case 'REQ_NOTE_ADDED': {
      const payload = event.payload as { note: RequirementNote } | undefined;
      if (reqs[reqId] && payload) {
        reqs[reqId] = {
          ...reqs[reqId]!,
          notes: [...reqs[reqId]!.notes, payload.note],
          updatedAt: event.timestamp,
        };
      }
      break;
    }
    default:
      break;
  }

  return { requirements: reqs, lastEventId: event.id, rebuiltAt: state.rebuiltAt };
}

export class RequirementsManager {
  readonly conductorDir: string;
  private state: RequirementsState;

  constructor(conductorDir?: string) {
    this.conductorDir = conductorDir ?? path.join(os.homedir(), '.conductor');
    this.state = { requirements: {}, lastEventId: '' };
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.conductorDir, { recursive: true });
    fs.mkdirSync(path.join(this.conductorDir, 'backups'), { recursive: true });
    await this.loadState();
  }

  private async loadState(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'requirements.snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      await this.rebuildFromEventLog();
      return;
    }
    try {
      const raw = fs.readFileSync(snapshotPath, 'utf8');
      const snapshot = JSON.parse(raw) as RequirementsState;
      this.state = snapshot;
      await this.replayEventsAfter(snapshot.lastEventId);
    } catch {
      await this.rebuildFromEventLog();
    }
  }

  private readEventLog(): RequirementEvent[] {
    const eventsPath = path.join(this.conductorDir, 'requirements.jsonl');
    if (!fs.existsSync(eventsPath)) return [];
    const raw = fs.readFileSync(eventsPath, 'utf8');
    const events: RequirementEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as RequirementEvent);
      } catch {
        // skip malformed lines
      }
    }
    return events;
  }

  private async replayEventsAfter(lastEventId: string): Promise<void> {
    const events = this.readEventLog();
    let found = lastEventId === '';
    for (const event of events) {
      if (!found) {
        if (event.id === lastEventId) found = true;
        continue;
      }
      this.state = applyEvent(this.state, event);
    }
  }

  async rebuildFromEventLog(): Promise<void> {
    const events = this.readEventLog();
    let state: RequirementsState = { requirements: {}, lastEventId: '' };
    for (const event of events) {
      state = applyEvent(state, event);
    }
    state.rebuiltAt = new Date().toISOString();
    this.state = state;
    await this.saveSnapshot();
  }

  private async appendEvent(
    type: RequirementEventType,
    reqId: string,
    payload?: unknown,
  ): Promise<RequirementEvent> {
    const event: RequirementEvent = {
      id: 'revt_' + nanoid(8),
      type,
      reqId,
      timestamp: new Date().toISOString(),
      payload,
    };
    const eventsPath = path.join(this.conductorDir, 'requirements.jsonl');
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
    this.state = applyEvent(this.state, event);
    await this.saveSnapshot();
    return event;
  }

  private async saveSnapshot(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'requirements.snapshot.json');
    const tmpPath = snapshotPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmpPath, snapshotPath);
    this.maybeWriteDailyBackup();
  }

  private maybeWriteDailyBackup(): void {
    const today = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(this.conductorDir, 'backups', `requirements-${today}.json`);
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, JSON.stringify(this.state, null, 2));
    }
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async capture(params: {
    title: string;
    description: string;
    targetProject?: string;
    labels?: string[];
    priority?: 1 | 2 | 3 | 4 | 5;
  }): Promise<Requirement> {
    const id = 'req_' + nanoid(8);
    const now = new Date().toISOString();
    const req: Requirement = {
      id,
      title: params.title,
      description: params.description,
      capturedAt: now,
      updatedAt: now,
      state: 'captured',
      priority: params.priority ?? 3,
      labels: params.labels ?? [],
      dependsOn: [],
      targetProject: params.targetProject,
      estimatedFiles: [],
      linkedTaskIds: [],
      notes: [],
      notificationsSent: [],
    };
    await this.appendEvent('REQ_CAPTURED', id, { req });
    return this.state.requirements[id]!;
  }

  async refine(id: string, patch: Partial<Pick<Requirement, 'description' | 'spec' | 'estimatedFiles' | 'labels' | 'priority' | 'targetProject'>>): Promise<Requirement> {
    const req = this.getOrThrow(id);
    await this.appendEvent('REQ_UPDATED', id, patch);
    // Also add a note if description changed
    if (patch.description && patch.description !== req.description) {
      await this.addNote(id, `Description updated`);
    }
    return this.state.requirements[id]!;
  }

  async setState(id: string, newState: RequirementState): Promise<Requirement> {
    const req = this.getOrThrow(id);
    assertTransition(req.state, newState);
    const previousState = req.state;
    await this.appendEvent('REQ_STATE_CHANGED', id, { state: newState });

    // Emit requirement.state.transitioned event — must never break core flow
    try {
      eventBus.publish({
        type: 'requirement.state.transitioned',
        actor: 'system',
        entity_type: 'requirement',
        entity_id: id,
        payload: {
          requirementId: id,
          rootPromptId: null,
          fromState: previousState,
          toState: newState,
          reason: 'orchestrator',
        },
      });
    } catch { /* ignore */ }

    // Emit pipeline.stage.advanced when reaching key stages
    if (newState === 'executing' || newState === 'done') {
      try {
        eventBus.publish({
          type: 'pipeline.stage.advanced',
          actor: 'system',
          entity_type: 'requirement',
          entity_id: id,
          payload: {
            promptId: null,
            stage: newState === 'executing' ? 'requirement_executing' : 'requirement_done',
            entityKind: 'requirement',
            entityId: id,
            durationFromStartMs: null,
          },
        });
      } catch { /* ignore */ }
    }

    // Insert timeline event into DB (best-effort)
    try {
      const db = getDb();
      const now = new Date().toISOString();
      db.insert(timelineEvents).values({
        id: 'tl_' + nanoid(8),
        kind: 'requirement.state.transitioned',
        actor: 'orchestrator',
        summary: `Requirement "${req.title ?? id}" → ${newState}`,
        subjectId: id,
        subjectKind: 'requirement',
        payload: JSON.stringify({ fromState: previousState, toState: newState }),
        projectId: undefined,
        createdAt: now,
      }).run();
    } catch { /* ignore — DB may not be initialized in tests */ }

    return this.state.requirements[id]!;
  }

  async addDependency(id: string, dependsOnId: string): Promise<Requirement> {
    this.getOrThrow(id);
    if (!this.state.requirements[dependsOnId]) {
      throw new Error(`Dependency target not found: ${dependsOnId}`);
    }
    if (this.wouldCreateCycle(id, dependsOnId)) {
      throw new Error(`Adding dependency ${id} → ${dependsOnId} would create a cycle`);
    }
    await this.appendEvent('REQ_DEP_ADDED', id, { dependsOnId });
    return this.state.requirements[id]!;
  }

  async linkTask(id: string, taskId: string): Promise<Requirement> {
    this.getOrThrow(id);
    await this.appendEvent('REQ_TASK_LINKED', id, { taskId });
    return this.state.requirements[id]!;
  }

  async addNote(id: string, text: string): Promise<Requirement> {
    this.getOrThrow(id);
    const note: RequirementNote = { ts: new Date().toISOString(), text };
    await this.appendEvent('REQ_NOTE_ADDED', id, { note });
    return this.state.requirements[id]!;
  }

  list(filter?: ListRequirementsFilter): Requirement[] {
    let reqs = Object.values(this.state.requirements);
    if (!filter) return reqs;
    if (filter.state !== undefined) {
      reqs = reqs.filter((r) => r.state === filter.state);
    }
    if (filter.priority !== undefined) {
      reqs = reqs.filter((r) => r.priority === filter.priority);
    }
    if (filter.labels && filter.labels.length > 0) {
      reqs = reqs.filter((r) => filter.labels!.some((l) => r.labels.includes(l)));
    }
    return reqs;
  }

  get(id: string): Requirement | undefined {
    return this.state.requirements[id];
  }

  getState(): RequirementsState {
    return this.state;
  }

  // ─── pickupNext: highest-priority 'ready' req with all deps done ───────────
  async pickupNext(): Promise<Requirement | null> {
    const ready = this.list({ state: 'ready' })
      .filter((r) => this.allDepsDone(r))
      .sort((a, b) => {
        if (a.priority !== b.priority) return a.priority - b.priority;
        return a.capturedAt.localeCompare(b.capturedAt);
      });

    if (ready.length === 0) return null;

    const picked = ready[0]!;
    await this.setState(picked.id, 'executing');
    return this.state.requirements[picked.id]!;
  }

  allDepsDone(req: Requirement): boolean {
    return req.dependsOn.every((depId) => {
      const dep = this.state.requirements[depId];
      return dep?.state === 'done';
    });
  }

  async markDone(id: string): Promise<Requirement> {
    const req = this.getOrThrow(id);
    // Allow verifying → done or executing → done (skip verifying in simple mode)
    if (req.state !== 'verifying' && req.state !== 'executing') {
      throw new Error(`Cannot mark done from state: ${req.state}`);
    }
    if (req.state === 'executing') {
      // Goes through verifying first — events emitted by setState()
      await this.setState(id, 'verifying');
    }
    // Final transition to done — events emitted by setState()
    await this.setState(id, 'done');
    return this.state.requirements[id]!;
  }

  // ─── Seed from external records ────────────────────────────────────────────
  async seedFromRecord(record: Omit<Requirement, 'id' | 'capturedAt' | 'updatedAt' | 'linkedTaskIds' | 'notes' | 'notificationsSent'>): Promise<Requirement> {
    const id = 'req_' + nanoid(8);
    const now = new Date().toISOString();
    const req: Requirement = {
      ...record,
      id,
      capturedAt: now,
      updatedAt: now,
      linkedTaskIds: [],
      notes: [],
      notificationsSent: [],
    };
    await this.appendEvent('REQ_CAPTURED', id, { req });
    return this.state.requirements[id]!;
  }

  // ─── Cycle detection ───────────────────────────────────────────────────────
  private wouldCreateCycle(id: string, newDepId: string): boolean {
    // DFS: starting from newDepId, can we reach id?
    const visited = new Set<string>();
    const stack = [newDepId];
    while (stack.length > 0) {
      const current = stack.pop()!;
      if (current === id) return true;
      if (visited.has(current)) continue;
      visited.add(current);
      const req = this.state.requirements[current];
      if (req) {
        for (const dep of req.dependsOn) {
          stack.push(dep);
        }
      }
    }
    return false;
  }

  private getOrThrow(id: string): Requirement {
    const req = this.state.requirements[id];
    if (!req) throw new Error(`Requirement not found: ${id}`);
    return req;
  }

  // ─── Spec helper ───────────────────────────────────────────────────────────
  async setSpec(id: string, spec: RequirementSpec): Promise<Requirement> {
    this.getOrThrow(id);
    await this.appendEvent('REQ_UPDATED', id, { spec });
    return this.state.requirements[id]!;
  }
}
