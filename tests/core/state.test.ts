import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateManager } from '../../src/core/state';
import type { ConductorState, Task } from '../../src/core/types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-test-'));
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 'tsk_test001',
    title: 'Test Task',
    status: 'queued',
    cwd: '/tmp',
    declaredFiles: ['src/**'],
    dependsOn: [],
    createdAt: new Date().toISOString(),
    spawnedBy: 'user',
    ...overrides,
  };
}

describe('StateManager', () => {
  let tmpDir: string;
  let manager: StateManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    manager = new StateManager(tmpDir);
    await manager.init();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('init', () => {
    it('creates conductor directory and required files on init', async () => {
      expect(fs.existsSync(tmpDir)).toBe(true);
      const backupsDir = path.join(tmpDir, 'backups');
      expect(fs.existsSync(backupsDir)).toBe(true);
    });

    it('initializes with empty state', () => {
      const state = manager.getState();
      expect(state.tasks).toEqual({});
      expect(state.events).toEqual([]);
      expect(state.lastEventId).toBe('');
    });
  });

  describe('appendEvent', () => {
    it('creates events.jsonl file with correct content', async () => {
      const task = makeTask();
      const event = await manager.appendEvent({
        type: 'TASK_ADDED',
        taskId: task.id,
        payload: { task },
      });

      const eventsPath = path.join(tmpDir, 'events.jsonl');
      expect(fs.existsSync(eventsPath)).toBe(true);

      const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]) as Record<string, unknown>;
      expect(parsed['type']).toBe('TASK_ADDED');
      expect(parsed['taskId']).toBe(task.id);
      expect(parsed['id']).toBeTruthy();
      expect(parsed['timestamp']).toBeTruthy();
    });

    it('appends multiple events correctly', async () => {
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: 'tsk_a1', payload: { task: makeTask({ id: 'tsk_a1' }) } });
      await manager.appendEvent({ type: 'TASK_STARTED', taskId: 'tsk_a1' });
      await manager.appendEvent({ type: 'TASK_COMPLETED', taskId: 'tsk_a1' });

      const eventsPath = path.join(tmpDir, 'events.jsonl');
      const lines = fs.readFileSync(eventsPath, 'utf8').trim().split('\n');
      expect(lines).toHaveLength(3);
    });

    it('returns event with id and timestamp', async () => {
      const event = await manager.appendEvent({ type: 'TASK_ADDED', taskId: 'tsk_x1' });
      expect(event.id).toMatch(/^evt_/);
      expect(event.timestamp).toBeTruthy();
      expect(new Date(event.timestamp).getTime()).not.toBeNaN();
    });

    it('updates lastEventId after appending', async () => {
      const event = await manager.appendEvent({ type: 'TASK_ADDED', taskId: 'tsk_x1' });
      expect(manager.getState().lastEventId).toBe(event.id);
    });
  });

  describe('getState', () => {
    it('returns correct materialized state after TASK_ADDED event', async () => {
      const task = makeTask();
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const state = manager.getState();
      expect(state.tasks[task.id]).toBeDefined();
      expect(state.tasks[task.id]!.title).toBe('Test Task');
    });

    it('updates task status on TASK_STARTED', async () => {
      const task = makeTask();
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await manager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: new Date().toISOString() } });

      const state = manager.getState();
      expect(state.tasks[task.id]!.status).toBe('running');
    });

    it('updates task status on TASK_COMPLETED', async () => {
      const task = makeTask();
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await manager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: new Date().toISOString() } });
      await manager.appendEvent({ type: 'TASK_COMPLETED', taskId: task.id, payload: { completedAt: new Date().toISOString() } });

      const state = manager.getState();
      expect(state.tasks[task.id]!.status).toBe('completed');
    });

    it('keeps events list capped at 1000', async () => {
      for (let i = 0; i < 1050; i++) {
        await manager.appendEvent({ type: 'TASK_ADDED', taskId: `tsk_${i}` });
      }
      const state = manager.getState();
      expect(state.events.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('rebuildFromEventLog', () => {
    it('recovers correct state after snapshot corruption', async () => {
      const task = makeTask();
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await manager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: new Date().toISOString() } });

      // Corrupt the snapshot
      const snapshotPath = path.join(tmpDir, 'state.snapshot.json');
      fs.writeFileSync(snapshotPath, 'CORRUPTED DATA {{{');

      // Rebuild
      const freshManager = new StateManager(tmpDir);
      await freshManager.init();
      await freshManager.rebuildFromEventLog();

      const state = freshManager.getState();
      expect(state.tasks[task.id]).toBeDefined();
      expect(state.tasks[task.id]!.status).toBe('running');
    });

    it('sets rebuiltAt on snapshot after rebuild', async () => {
      await manager.rebuildFromEventLog();
      const state = manager.getState();
      expect(state.rebuiltAt).toBeTruthy();
    });
  });

  describe('getTask', () => {
    it('returns task by id', async () => {
      const task = makeTask();
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      const found = manager.getTask(task.id);
      expect(found).toBeDefined();
      expect(found!.id).toBe(task.id);
    });

    it('returns undefined for missing id', () => {
      const found = manager.getTask('tsk_missing');
      expect(found).toBeUndefined();
    });
  });

  describe('listTasks', () => {
    it('returns all tasks without filter', async () => {
      const t1 = makeTask({ id: 'tsk_list1', status: 'running' });
      const t2 = makeTask({ id: 'tsk_list2', status: 'completed' });
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: t1.id, payload: { task: t1 } });
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: t2.id, payload: { task: t2 } });

      const tasks = manager.listTasks();
      expect(tasks).toHaveLength(2);
    });

    it('filters by status', async () => {
      const t1 = makeTask({ id: 'tsk_filt1', status: 'running' });
      const t2 = makeTask({ id: 'tsk_filt2', status: 'completed' });
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: t1.id, payload: { task: t1 } });
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: t2.id, payload: { task: t2 } });

      const running = manager.listTasks({ status: 'running' });
      expect(running).toHaveLength(1);
      expect(running[0]!.id).toBe('tsk_filt1');
    });

    it('filters by spawnedBy', async () => {
      const t1 = makeTask({ id: 'tsk_sp1', spawnedBy: 'claude' });
      const t2 = makeTask({ id: 'tsk_sp2', spawnedBy: 'user' });
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: t1.id, payload: { task: t1 } });
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: t2.id, payload: { task: t2 } });

      const claudeTasks = manager.listTasks({ spawnedBy: 'claude' });
      expect(claudeTasks).toHaveLength(1);
      expect(claudeTasks[0]!.id).toBe('tsk_sp1');
    });
  });

  describe('getEventsSince', () => {
    it('returns all events when no id given', async () => {
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: 'tsk_e1' });
      await manager.appendEvent({ type: 'TASK_STARTED', taskId: 'tsk_e1' });

      const events = manager.getEventsSince();
      expect(events.length).toBe(2);
    });

    it('returns events after given id', async () => {
      const e1 = await manager.appendEvent({ type: 'TASK_ADDED', taskId: 'tsk_e2' });
      await manager.appendEvent({ type: 'TASK_STARTED', taskId: 'tsk_e2' });
      await manager.appendEvent({ type: 'TASK_COMPLETED', taskId: 'tsk_e2' });

      const events = manager.getEventsSince(e1.id);
      expect(events.length).toBe(2);
    });
  });

  describe('snapshot persistence', () => {
    it('state is consistent after multiple events', async () => {
      const task = makeTask();
      await manager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await manager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: new Date().toISOString() } });
      await manager.appendEvent({ type: 'TASK_FAILED', taskId: task.id, payload: { reason: 'test error' } });

      // Load fresh manager from same dir
      const fresh = new StateManager(tmpDir);
      await fresh.init();
      const state = fresh.getState();
      expect(state.tasks[task.id]!.status).toBe('failed');
    });
  });
});
