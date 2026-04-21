import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { execSync } from 'child_process';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import { assertBlockerTransition } from './state-machine';
import type {
  Blocker,
  BlockerDrainResult,
  BlockerEvent,
  BlockerEventType,
  BlockersState,
  BlockerState,
  CreateBlockerParams,
  DrainedBlocker,
} from './types';

function applyEvent(state: BlockersState, event: BlockerEvent): BlockersState {
  const blockers = { ...state.blockers };
  const { blockerId } = event;

  switch (event.type) {
    case 'BLOCKER_CREATED': {
      const payload = event.payload as { blocker: Blocker } | undefined;
      if (payload?.blocker) {
        blockers[blockerId] = { ...payload.blocker };
      }
      break;
    }
    case 'BLOCKER_RESOLVED': {
      const payload = event.payload as { note?: string; resolvedBy?: string } | undefined;
      if (blockers[blockerId]) {
        blockers[blockerId] = {
          ...blockers[blockerId]!,
          state: 'resolved',
          resolvedAt: event.timestamp,
          resolvedBy: payload?.resolvedBy,
          resolutionNote: payload?.note,
        };
      }
      break;
    }
    case 'BLOCKER_CANCELLED': {
      if (blockers[blockerId]) {
        blockers[blockerId] = { ...blockers[blockerId]!, state: 'cancelled' };
      }
      break;
    }
    default:
      break;
  }

  return { blockers, lastEventId: event.id, rebuiltAt: state.rebuiltAt };
}

export class BlockersManager {
  readonly conductorDir: string;
  private state: BlockersState;
  private pendingDrain: DrainedBlocker[] = [];

  constructor(conductorDir?: string) {
    this.conductorDir = conductorDir ?? path.join(os.homedir(), '.conductor');
    this.state = { blockers: {}, lastEventId: '' };
  }

  async init(): Promise<void> {
    fs.mkdirSync(this.conductorDir, { recursive: true });
    await this.loadState();
  }

  private async loadState(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'blockers.snapshot.json');
    if (!fs.existsSync(snapshotPath)) {
      await this.rebuildFromEventLog();
      return;
    }
    try {
      const raw = fs.readFileSync(snapshotPath, 'utf8');
      const snapshot = JSON.parse(raw) as BlockersState;
      this.state = snapshot;
      await this.replayEventsAfter(snapshot.lastEventId);
    } catch {
      await this.rebuildFromEventLog();
    }
  }

  private readEventLog(): BlockerEvent[] {
    const eventsPath = path.join(this.conductorDir, 'blockers.jsonl');
    if (!fs.existsSync(eventsPath)) return [];
    const raw = fs.readFileSync(eventsPath, 'utf8');
    const events: BlockerEvent[] = [];
    for (const line of raw.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        events.push(JSON.parse(trimmed) as BlockerEvent);
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
    let state: BlockersState = { blockers: {}, lastEventId: '' };
    for (const event of events) {
      state = applyEvent(state, event);
    }
    state.rebuiltAt = new Date().toISOString();
    this.state = state;
    await this.saveSnapshot();
  }

  private async appendEvent(
    type: BlockerEventType,
    blockerId: string,
    payload?: unknown,
  ): Promise<BlockerEvent> {
    const event: BlockerEvent = {
      id: 'bevt_' + nanoid(8),
      type,
      blockerId,
      timestamp: new Date().toISOString(),
      payload,
    };
    const eventsPath = path.join(this.conductorDir, 'blockers.jsonl');
    fs.appendFileSync(eventsPath, JSON.stringify(event) + '\n');
    this.state = applyEvent(this.state, event);
    await this.saveSnapshot();
    return event;
  }

  private async saveSnapshot(): Promise<void> {
    const snapshotPath = path.join(this.conductorDir, 'blockers.snapshot.json');
    const tmpPath = snapshotPath + '.tmp';
    fs.writeFileSync(tmpPath, JSON.stringify(this.state, null, 2));
    fs.renameSync(tmpPath, snapshotPath);
  }

  // ─── Public API ────────────────────────────────────────────────────────────

  async create(params: CreateBlockerParams): Promise<Blocker> {
    const id = 'blk_' + nanoid(8);
    const now = new Date().toISOString();
    const blocker: Blocker = {
      id,
      title: params.title,
      createdAt: now,
      state: 'open',
      severity: params.severity,
      requirementId: params.requirementId,
      taskId: params.taskId,
      kind: params.kind,
      description: params.description,
      resolutionSteps: params.resolutionSteps,
      approvalButton: params.approvalButton,
      links: params.links,
    };
    await this.appendEvent('BLOCKER_CREATED', id, { blocker });
    this.sendNativeNotification(params.title, id);
    return this.state.blockers[id]!;
  }

  async resolve(id: string, note?: string): Promise<Blocker> {
    const blocker = this.getOrThrow(id);
    assertBlockerTransition(blocker.state, 'resolved');
    await this.appendEvent('BLOCKER_RESOLVED', id, { note, resolvedBy: 'user' });
    const resolved = this.state.blockers[id]!;
    this.pendingDrain.push({ blocker: resolved, approvalPayload: blocker.approvalButton?.payload });
    return resolved;
  }

  async cancel(id: string): Promise<Blocker> {
    const blocker = this.getOrThrow(id);
    assertBlockerTransition(blocker.state, 'cancelled');
    await this.appendEvent('BLOCKER_CANCELLED', id);
    return this.state.blockers[id]!;
  }

  list(state?: BlockerState): Blocker[] {
    const all = Object.values(this.state.blockers);
    if (!state) return all;
    return all.filter((b) => b.state === state);
  }

  get(id: string): Blocker | undefined {
    return this.state.blockers[id];
  }

  drain(): BlockerDrainResult {
    const resolvedBlockers = [...this.pendingDrain];
    this.pendingDrain = [];
    return { resolvedBlockers };
  }

  openCount(): number {
    return this.list('open').length;
  }

  // Seed from external record — used for seeding historical data
  async seedFromRecord(
    record: Omit<Blocker, 'id' | 'createdAt'> & { createdAt?: string },
  ): Promise<Blocker> {
    const id = 'blk_' + nanoid(8);
    const now = record.createdAt ?? new Date().toISOString();
    const blocker: Blocker = { ...record, id, createdAt: now };
    await this.appendEvent('BLOCKER_CREATED', id, { blocker });
    if (record.state === 'resolved') {
      await this.appendEvent('BLOCKER_RESOLVED', id, {
        note: record.resolutionNote,
        resolvedBy: record.resolvedBy ?? 'seed',
      });
    } else if (record.state === 'cancelled') {
      await this.appendEvent('BLOCKER_CANCELLED', id);
    }
    return this.state.blockers[id]!;
  }

  // ─── Internal helpers ──────────────────────────────────────────────────────

  private sendNativeNotification(title: string, id: string): void {
    try {
      const safeTitle = title.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
      execSync(
        `osascript -e 'display notification "${safeTitle}" with title "PokerZeno Conductor" subtitle "Blocker needs you"'`,
        { timeout: 3000, stdio: 'ignore' },
      );
    } catch {
      // best-effort
    }
  }

  private getOrThrow(id: string): Blocker {
    const blocker = this.state.blockers[id];
    if (!blocker) throw new Error(`Blocker not found: ${id}`);
    return blocker;
  }
}
