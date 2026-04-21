import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateManager } from '../../src/core/state';
import { LockManager } from '../../src/core/locks';
import type { Task } from '../../src/core/types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-locks-'));
}

function makeRunningTask(id: string, globs: string[]): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'running',
    cwd: '/tmp/project',
    declaredFiles: globs,
    dependsOn: [],
    createdAt: new Date().toISOString(),
    startedAt: new Date().toISOString(),
    spawnedBy: 'user',
  };
}

describe('LockManager', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let lockManager: LockManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    stateManager = new StateManager(tmpDir);
    await stateManager.init();
    lockManager = new LockManager(stateManager);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('check', () => {
    it('returns clean when no running tasks', () => {
      const result = lockManager.check(['src/auth/login.ts']);
      expect(result.clean).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('returns conflict when running task declares matching glob', async () => {
      const task = makeRunningTask('tsk_lock1', ['src/auth/**']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: task.startedAt } });

      const result = lockManager.check(['src/auth/login.ts']);
      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(1);
      expect(result.conflicts[0]!.file).toBe('src/auth/login.ts');
      expect(result.conflicts[0]!.taskId).toBe('tsk_lock1');
      expect(result.conflicts[0]!.matchedGlob).toBe('src/auth/**');
    });

    it('returns clean for non-matching files', async () => {
      const task = makeRunningTask('tsk_lock2', ['src/auth/**']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: task.startedAt } });

      const result = lockManager.check(['src/unrelated/file.ts']);
      expect(result.clean).toBe(true);
      expect(result.conflicts).toHaveLength(0);
    });

    it('handles multiple conflicting files', async () => {
      const task = makeRunningTask('tsk_lock3', ['src/**']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: task.startedAt } });

      const result = lockManager.check(['src/a.ts', 'src/b.ts']);
      expect(result.clean).toBe(false);
      expect(result.conflicts).toHaveLength(2);
    });

    it('returns clean when task is completed (not running)', async () => {
      const task = makeRunningTask('tsk_lock4', ['src/auth/**']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: task.startedAt } });
      await stateManager.appendEvent({ type: 'TASK_COMPLETED', taskId: task.id, payload: { completedAt: new Date().toISOString() } });

      const result = lockManager.check(['src/auth/login.ts']);
      expect(result.clean).toBe(true);
    });

    it('only conflicts with running tasks, not queued', async () => {
      const task: Task = {
        ...makeRunningTask('tsk_lock5', ['src/**']),
        status: 'queued',
        startedAt: undefined,
      };
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const result = lockManager.check(['src/auth/login.ts']);
      expect(result.clean).toBe(true);
    });
  });

  describe('matchesGlob', () => {
    it('matches exact file path', () => {
      expect(lockManager.matchesGlob('src/foo.ts', 'src/foo.ts')).toBe(true);
    });

    it('matches wildcard glob', () => {
      expect(lockManager.matchesGlob('src/auth/login.ts', 'src/auth/**')).toBe(true);
    });

    it('matches deep nested path', () => {
      expect(lockManager.matchesGlob('src/deep/nested/file.ts', 'src/**')).toBe(true);
    });

    it('does not match different directory', () => {
      expect(lockManager.matchesGlob('lib/foo.ts', 'src/**')).toBe(false);
    });

    it('matches single-level wildcard', () => {
      expect(lockManager.matchesGlob('src/foo.ts', 'src/*.ts')).toBe(true);
    });

    it('does not match nested with single wildcard', () => {
      expect(lockManager.matchesGlob('src/nested/foo.ts', 'src/*.ts')).toBe(false);
    });
  });

  describe('getLocksFor', () => {
    it('returns running tasks that match the pattern', async () => {
      const task = makeRunningTask('tsk_glock1', ['src/auth/**']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: task.startedAt } });

      const locks = lockManager.getLocksFor('src/auth/login.ts');
      expect(locks).toHaveLength(1);
      expect(locks[0]!.id).toBe('tsk_glock1');
    });

    it('returns empty when no tasks match', () => {
      const locks = lockManager.getLocksFor('src/auth/login.ts');
      expect(locks).toHaveLength(0);
    });
  });

  describe('getExpiredTasks', () => {
    it('returns tasks running longer than TTL', async () => {
      const oldStart = new Date(Date.now() - 7 * 60 * 60 * 1000).toISOString(); // 7h ago
      const task: Task = {
        ...makeRunningTask('tsk_ttl1', ['src/**']),
        startedAt: oldStart,
      };
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: oldStart } });

      const expired = lockManager.getExpiredTasks();
      expect(expired.some(t => t.id === 'tsk_ttl1')).toBe(true);
    });

    it('does not return tasks within TTL', async () => {
      const recentStart = new Date(Date.now() - 1 * 60 * 60 * 1000).toISOString(); // 1h ago
      const task: Task = {
        ...makeRunningTask('tsk_ttl2', ['src/**']),
        startedAt: recentStart,
      };
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: recentStart } });

      const expired = lockManager.getExpiredTasks();
      expect(expired.some(t => t.id === 'tsk_ttl2')).toBe(false);
    });

    it('respects custom TTL argument', async () => {
      const start = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(); // 2h ago
      const task: Task = {
        ...makeRunningTask('tsk_ttl3', ['src/**']),
        startedAt: start,
      };
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });
      await stateManager.appendEvent({ type: 'TASK_STARTED', taskId: task.id, payload: { startedAt: start } });

      // With 1h TTL, task is expired
      const expired1h = lockManager.getExpiredTasks(1 * 60 * 60 * 1000);
      expect(expired1h.some(t => t.id === 'tsk_ttl3')).toBe(true);

      // With 3h TTL, task is not expired
      const expired3h = lockManager.getExpiredTasks(3 * 60 * 60 * 1000);
      expect(expired3h.some(t => t.id === 'tsk_ttl3')).toBe(false);
    });
  });
});
