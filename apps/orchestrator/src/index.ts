import * as path from 'path';
import * as os from 'os';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import { StateManager } from './core/state';
import { LockManager } from './core/locks';
import { DepsManager } from './core/deps';
import { AuditManager } from './core/audit';
import { ConductorMetrics } from './observability/conductor-metrics';
import type {
  AddParams,
  AddResult,
  AuditResult,
  CheckResult,
  ConductorState,
  SpawnedBy,
  Task,
  TaskStatus,
} from './core/types';

export type { AddParams, AddResult, AuditResult, CheckResult, ConductorState, Task, TaskStatus, SpawnedBy };
export { ConductorMetrics };
export * from './core/types';

export class Conductor {
  private readonly stateManager: StateManager;
  private readonly lockManager: LockManager;
  private readonly depsManager: DepsManager;
  private readonly auditManager: AuditManager;
  readonly metrics: ConductorMetrics;

  constructor(conductorDir?: string, metrics?: ConductorMetrics) {
    const dir = conductorDir ?? path.join(os.homedir(), '.conductor');
    this.stateManager = new StateManager(dir);
    this.lockManager = new LockManager(this.stateManager);
    this.depsManager = new DepsManager(this.stateManager);
    this.auditManager = new AuditManager(this.stateManager);
    this.metrics = metrics ?? new ConductorMetrics();
  }

  async init(): Promise<void> {
    await this.stateManager.init();
  }

  async add(params: AddParams): Promise<AddResult> {
    const id = 'tsk_' + nanoid(8);
    const conflicts = this.lockManager.check(params.files);

    // Check for cycles
    if (params.dependsOn && params.dependsOn.length > 0) {
      if (this.depsManager.wouldCreateCycle(id, params.dependsOn)) {
        throw new Error(`Adding task ${id} would create a dependency cycle`);
      }
    }

    // Determine initial status
    const dependsOn = params.dependsOn ?? [];
    const tempTask: Task = {
      id,
      title: params.title,
      status: 'queued',
      cwd: params.cwd,
      declaredFiles: params.files,
      dependsOn,
      createdAt: new Date().toISOString(),
      spawnedBy: params.spawnedBy ?? 'user',
      notes: params.notes,
    };

    const blockedBy = this.depsManager.computeBlockedBy(tempTask);
    const initialStatus: TaskStatus = blockedBy.length > 0 ? 'blocked' : 'queued';

    const task: Task = { ...tempTask, status: initialStatus };
    if (blockedBy.length > 0) {
      task.blockedBy = blockedBy;
    }

    await this.stateManager.appendEvent({
      type: 'TASK_ADDED',
      taskId: id,
      payload: { task },
    });

    this.metrics.recordTaskAdded(params.spawnedBy ?? 'user');
    this.metrics.recordLockConflict(conflicts.conflicts.length);
    return { id, status: initialStatus, conflicts: conflicts.conflicts, blockedBy };
  }

  check(files: string[]): CheckResult {
    return this.lockManager.check(files);
  }

  async start(id: string): Promise<Task> {
    const task = this.stateManager.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);
    if (task.status !== 'queued') {
      throw new Error(`Task ${id} is not in queued state (current: ${task.status})`);
    }

    const blockedBy = this.depsManager.computeBlockedBy(task);
    if (blockedBy.length > 0) {
      await this.stateManager.appendEvent({
        type: 'TASK_BLOCKED',
        taskId: id,
        payload: { blockedBy },
      });
      this.metrics.recordTaskBlocked();
      const updated = this.stateManager.getTask(id)!;
      return updated;
    }

    const startedAt = new Date().toISOString();
    await this.stateManager.appendEvent({
      type: 'TASK_STARTED',
      taskId: id,
      payload: { startedAt },
    });
    this.metrics.recordTaskStarted();

    return this.stateManager.getTask(id)!;
  }

  async complete(id: string, actualFiles?: string[]): Promise<Task> {
    const task = this.stateManager.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    const completedAt = new Date().toISOString();
    await this.stateManager.appendEvent({
      type: 'TASK_COMPLETED',
      taskId: id,
      payload: { completedAt, actualFiles },
    });

    // Release lock event
    await this.stateManager.appendEvent({ type: 'LOCK_RELEASED', taskId: id });

    // Check if any blocked tasks can now unblock
    await this.unblockDependents(id);

    this.metrics.recordTaskTerminated('completed', task.spawnedBy, task.startedAt);
    return this.stateManager.getTask(id)!;
  }

  async fail(id: string, reason?: string): Promise<Task> {
    const task = this.stateManager.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    await this.stateManager.appendEvent({
      type: 'TASK_FAILED',
      taskId: id,
      payload: { reason },
    });

    this.metrics.recordTaskTerminated('failed', task.spawnedBy, task.startedAt);
    return this.stateManager.getTask(id)!;
  }

  async cancel(id: string): Promise<Task> {
    const task = this.stateManager.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    await this.stateManager.appendEvent({ type: 'TASK_CANCELLED', taskId: id });

    this.metrics.recordTaskTerminated('cancelled', task.spawnedBy, task.startedAt);
    return this.stateManager.getTask(id)!;
  }

  status(): ConductorState {
    return this.stateManager.getState();
  }

  list(filter?: { status?: TaskStatus }): Task[] {
    return this.stateManager.listTasks(filter);
  }

  dag(rootId?: string): { nodes: Task[]; edges: Array<{ from: string; to: string }> } {
    return this.depsManager.getDAG(rootId);
  }

  async release(id: string): Promise<void> {
    const task = this.stateManager.getTask(id);
    if (!task) throw new Error(`Task not found: ${id}`);

    await this.stateManager.appendEvent({ type: 'LOCK_RELEASED', taskId: id });
    // Mark as cancelled if still running
    if (task.status === 'running') {
      await this.stateManager.appendEvent({ type: 'TASK_CANCELLED', taskId: id });
    }
  }

  async audit(id: string): Promise<AuditResult> {
    return this.auditManager.audit(id);
  }

  async reconcile(
    liveSessionIds: string[],
  ): Promise<{ drifted: Task[] }> {
    const runningTasks = this.stateManager.listTasks({ status: 'running' });
    const liveSet = new Set(liveSessionIds);
    const drifted: Task[] = [];

    for (const task of runningTasks) {
      if (task.sessionId && !liveSet.has(task.sessionId)) {
        await this.stateManager.appendEvent({
          type: 'RECONCILE_DRIFT',
          taskId: task.id,
          payload: { sessionId: task.sessionId },
        });
        drifted.push(task);
      }
    }

    this.metrics.recordReconcileDrift(drifted.length);
    return { drifted };
  }

  getHistory(since?: string): ReturnType<StateManager['getEventsSince']> {
    return this.stateManager.getEventsSince(since);
  }

  async expireStaleTasks(ttlMs?: number): Promise<Task[]> {
    const expired = this.lockManager.getExpiredTasks(ttlMs);
    for (const task of expired) {
      await this.stateManager.appendEvent({
        type: 'TASK_TTL_EXPIRED',
        taskId: task.id,
        payload: { startedAt: task.startedAt },
      });
    }
    this.metrics.recordTtlExpired(expired.length);
    return expired;
  }

  // Optional shutdown hook (for HTTP servers started externally)
  shutdown?: () => Promise<void>;

  private async unblockDependents(completedTaskId: string): Promise<void> {
    const allTasks = this.stateManager.listTasks({ status: 'blocked' });
    for (const task of allTasks) {
      if (!task.dependsOn.includes(completedTaskId)) continue;
      const stillBlocked = this.depsManager.computeBlockedBy(task);
      if (stillBlocked.length === 0) {
        await this.stateManager.appendEvent({
          type: 'TASK_UNBLOCKED',
          taskId: task.id,
        });
        this.metrics.recordTaskUnblocked();
      }
    }
  }
}
