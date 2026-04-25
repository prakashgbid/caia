import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateManager } from '../../src/core/state';
import { AuditManager } from '../../src/core/audit';
import type { Task } from '../../src/core/types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-audit-'));
}

function makeCompletedTask(id: string, declared: string[], actual: string[]): Task {
  return {
    id,
    title: `Task ${id}`,
    status: 'completed',
    cwd: '/tmp/project',
    declaredFiles: declared,
    actualFiles: actual,
    dependsOn: [],
    createdAt: new Date(Date.now() - 10000).toISOString(),
    startedAt: new Date(Date.now() - 5000).toISOString(),
    completedAt: new Date().toISOString(),
    spawnedBy: 'user',
  };
}

describe('AuditManager', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let auditManager: AuditManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    stateManager = new StateManager(tmpDir);
    await stateManager.init();
    auditManager = new AuditManager(stateManager);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('audit', () => {
    it('returns clean when actual matches declared exactly', async () => {
      const declared = ['src/auth/login.ts', 'src/auth/logout.ts'];
      const actual = ['src/auth/login.ts', 'src/auth/logout.ts'];
      const task = makeCompletedTask('tsk_aud1', declared, actual);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const result = auditManager.audit(task.id);
      expect(result.clean).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.extra).toHaveLength(0);
    });

    it('returns extra files when task touched undeclared files', async () => {
      const declared = ['src/auth/login.ts'];
      const actual = ['src/auth/login.ts', 'src/auth/secret.ts'];
      const task = makeCompletedTask('tsk_aud2', declared, actual);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const result = auditManager.audit(task.id);
      expect(result.clean).toBe(false);
      expect(result.extra).toContain('src/auth/secret.ts');
      expect(result.missing).toHaveLength(0);
    });

    it('returns missing files when declared files were not touched', async () => {
      const declared = ['src/auth/login.ts', 'src/auth/logout.ts'];
      const actual = ['src/auth/login.ts'];
      const task = makeCompletedTask('tsk_aud3', declared, actual);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const result = auditManager.audit(task.id);
      expect(result.clean).toBe(false);
      expect(result.missing).toContain('src/auth/logout.ts');
      expect(result.extra).toHaveLength(0);
    });

    it('returns both extra and missing', async () => {
      const declared = ['src/auth/login.ts', 'src/auth/forgot.ts'];
      const actual = ['src/auth/login.ts', 'src/auth/reset.ts'];
      const task = makeCompletedTask('tsk_aud4', declared, actual);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const result = auditManager.audit(task.id);
      expect(result.clean).toBe(false);
      expect(result.missing).toContain('src/auth/forgot.ts');
      expect(result.extra).toContain('src/auth/reset.ts');
    });

    it('returns declared and actual in result', async () => {
      const declared = ['src/auth/login.ts'];
      const actual = ['src/auth/login.ts'];
      const task = makeCompletedTask('tsk_aud5', declared, actual);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const result = auditManager.audit(task.id);
      expect(result.taskId).toBe(task.id);
      expect(result.declared).toEqual(declared);
      expect(result.actual).toEqual(actual);
    });

    it('returns empty actual when task has no actualFiles', async () => {
      const task: Task = {
        id: 'tsk_aud6',
        title: 'Task without actual',
        status: 'completed',
        cwd: '/tmp/project',
        declaredFiles: ['src/foo.ts'],
        dependsOn: [],
        createdAt: new Date().toISOString(),
        spawnedBy: 'user',
      };
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const result = auditManager.audit(task.id);
      expect(result.actual).toHaveLength(0);
      expect(result.missing).toContain('src/foo.ts');
    });

    it('throws for unknown task id', () => {
      expect(() => auditManager.audit('tsk_unknown')).toThrow();
    });
  });

  describe('getActualChangedFiles', () => {
    it('returns empty array when no git changes', async () => {
      // Use a temp directory that is not a git repo
      const notGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'not-git-'));
      try {
        const files = await auditManager.getActualChangedFiles(notGitDir, new Date().toISOString());
        expect(Array.isArray(files)).toBe(true);
      } finally {
        fs.rmSync(notGitDir, { recursive: true, force: true });
      }
    });
  });
});
