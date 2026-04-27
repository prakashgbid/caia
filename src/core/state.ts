import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import type {
  ConductorEvent,
  ConductorState,
  SpawnedBy,
  Task,
  TaskStatus,
} from './types';

function applyEvent(state: ConductorState, event: ConductorEvent): ConductorState {
  const tasks = { ...state.tasks };
  const taskId = event.taskId;

  switch (event.type) {
    case 'TASK_ADDED': {
      const payload = event.payload as { task: Task } | undefined;
      if (payload?.task && taskId) {
        tasks[taskId] = { ...payload.task };
      }
      break;
    }
    case 'TASK_STARTED': {
      if (taskId && tasks[taskId]) {
        const payload = event.payload as { startedAt?: string } | undefined;
        tasks[taskId] = {
          ...tasks[taskId]!,
          status: 'running',
          startedAt: payload?.startedAt ?? event.timestamp,
        };
      }
      break;
    }
    case 'TASK_COMPLETED': {
      if (taskId && tasks[taskId]) {
        const payload = event.payload as {
          completedAt?: string;
          actualFiles?: string[];
        } | undefined;
        tasks[taskId] = {
          ...tasks[taskId]!,
          status: 'completed',
          completedAt: payload?.completedAt ?? event.timestamp,
          ...(payload?.actualFiles !== undefined ? { actualFiles: payload.actualFiles } : {}),
        };
      }
      break;
    }
    case 'TASK_FAILED': {
      if (taskId && tasks[taskId]) {
        tasks[taskId] = { ...tasks[taskId]!, status: 'failed' };
      }
      break;
    }
    case 'TASK_CANCELLED': {
      if (taskId && tasks[taskId]) {
        tasks[taskId] = { ...tasks[taskId]!, status: 'cancelled' };
      }
      break;
    }
    case 'TASK_BLOCKED': {
      if (taskId && tasks[taskId]) {
        const payload = event.payload as { blockedBy?: string[] } | undefined;
        tasks[taskId] = {
          ...tasks[taskId]!,
          status: 'blocked',
          blockedBy: payload?.blockedBy,
        };
      }
      break;
    }
    case 'TASK_UNBLOCKED': {
      if (taskId && tasks[taskId]) {
        tasks[taskId] = { ...tasks[taskId]!, status: 'queued', blockedBy: [] };
      }
      break;
    }
    case 'TASK_TTL_EXPIRED': {
      if (taskId && tasks[taskId]) {
        tasks[taskId] = { ...tasks[taskId]!, status: 'failed' };
      }
      break;
    }
    case 'RECONCILE_DRIFT': {
      if (taskId && tasks[taskId]) {
        tasks[taskId] = { ...tasks[taskId]!, status: 'failed' };
      }
      break;
    }
    default:
      break;
  }

  const events = [...state.events, event].slice(-1000);
  return { tasks, events, lastEventId: event.id, rebuiltAt: state.rebuiltAt };
}

export class StateManager {
  readonly conductorDir: string;
  private state: ConductorState;

  constructor(conductorDir?: string) {
    this.conductorDir = conductorDir ?? path.join(os.homedir(), '.conductor');
    this.state = { tasks: {}, events: [], lastEventId: '' };
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.conductorDir, { recursive: true });
    fs.mkdirSync(path.join(this.conductorDir, 'backups'), { recursive: true });
    await this.loadState();
  }

  private async loadState(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'state.snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      await this.rebuildFromEventLog();
      return;
    }
    try {
      const raw = fs.readFileSync(snapshotPath, 'utf8');
      const snapshot = JSON.parse(raw) as ConductorState;
      this.state = snapshot;
      await this.replayEventsAfter(snapshot.lastEventId);
    } catch {
      await this.rebuildFromEventLog();
    }
  }

  private readEventLog(): ConductorEvent[] {
    const eventsPath = path.join(this.conductorDir, 'events.jsonl');
    if (!fs.existsSync(eventsPath)) return [];
    const raw = fs.readFileSync(eventsPath, 'utf8');
    const events: ConductorEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as ConductorEvent);
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
    let state: ConductorState = { tasks: {}, events: [], lastEventId: '' };
    for (const event of events) {
      state = applyEvent(state, event);
    }
    state.rebuiltAt = new Date().toISOString();
    this.state = state;
    await this.saveSnapshot();

    // Only emit SNAPSHOT_REBUILT when there were actual events to replay
    if (events.length > 0) {
      const rebuildEvent: ConductorEvent = {
        id: 'evt_' + nanoid(8),
        type: 'SNAPSHOT_REBUILT',
        timestamp: new Date().toISOString(),
      };
      this.appendEventLine(rebuildEvent);
      this.state = applyEvent(this.state, rebuildEvent);
      await this.saveSnapshot();
    }
  }

  async appendEvent(
    event: Omit<ConductorEvent, 'id' | 'timestamp'>,
  ): Promise<ConductorEvent> {
    const full: ConductorEvent = {
      id: 'evt_' + nanoid(8),
      timestamp: new Date().toISOString(),
      ...event,
    };
    this.appendEventLine(full);
    this.state = applyEvent(this.state, full);
    await this.saveSnapshot();
    return full;
  }

  private appendEventLine(event: ConductorEvent): void {
    const eventsPath = path.join(this.conductorDir, 'events.jsonl');
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
  }

  private async saveSnapshot(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'state.snapshot.json');
    const tmpPath = snapshotPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmpPath, snapshotPath);
    this.maybeWriteDailyBackup();
  }

  private maybeWriteDailyBackup(): void {
    const today = new Date().toISOString().slice(0, 10);
    const backupPath = path.join(this.conductorDir, 'backups', `${today}.json`);
    if (!fs.existsSync(backupPath)) {
      fs.writeFileSync(backupPath, JSON.stringify(this.state, null, 2));
    }
  }

  getState(): ConductorState {
    return this.state;
  }

  getTask(id: string): Task | undefined {
    return this.state.tasks[id];
  }

  listTasks(filter?: { status?: TaskStatus; spawnedBy?: SpawnedBy }): Task[] {
    const tasks = Object.values(this.state.tasks);
    if (!filter) return tasks;
    return tasks.filter((t) => {
      if (filter.status !== undefined && t.status !== filter.status) return false;
      if (filter.spawnedBy !== undefined && t.spawnedBy !== filter.spawnedBy) return false;
      return true;
    });
  }

  getEventsSince(eventId?: string): ConductorEvent[] {
    if (!eventId) return this.state.events;
    const idx = this.state.events.findIndex((e) => e.id === eventId);
    if (idx === -1) return this.state.events;
    return this.state.events.slice(idx + 1);
  }
}
