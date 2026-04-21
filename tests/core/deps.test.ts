import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { StateManager } from '../../src/core/state';
import { DepsManager } from '../../src/core/deps';
import type { Task } from '../../src/core/types';

function makeTempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-deps-'));
}

function makeTask(id: string, dependsOn: string[] = [], status: Task['status'] = 'queued'): Task {
  return {
    id,
    title: `Task ${id}`,
    status,
    cwd: '/tmp/project',
    declaredFiles: [`src/${id}/**`],
    dependsOn,
    createdAt: new Date().toISOString(),
    spawnedBy: 'user',
  };
}

describe('DepsManager', () => {
  let tmpDir: string;
  let stateManager: StateManager;
  let depsManager: DepsManager;

  beforeEach(async () => {
    tmpDir = makeTempDir();
    stateManager = new StateManager(tmpDir);
    await stateManager.init();
    depsManager = new DepsManager(stateManager);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('wouldCreateCycle', () => {
    it('returns false when no tasks exist', () => {
      expect(depsManager.wouldCreateCycle('tsk_new', ['tsk_other'])).toBe(false);
    });

    it('returns false when dependency has no back-edge', async () => {
      // A depends on B, B has no deps
      const taskB = makeTask('tsk_B');
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });

      expect(depsManager.wouldCreateCycle('tsk_A', ['tsk_B'])).toBe(false);
    });

    it('returns true on direct cycle: A depends on B, adding B depends on A', async () => {
      // A already exists depending on B
      const taskA = makeTask('tsk_A2', ['tsk_B2']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });

      // Adding B that depends on A would create cycle
      expect(depsManager.wouldCreateCycle('tsk_B2', ['tsk_A2'])).toBe(true);
    });

    it('returns true on indirect cycle: A→B→C, adding C depends on A', async () => {
      const taskA = makeTask('tsk_cyc_A', ['tsk_cyc_B']);
      const taskB = makeTask('tsk_cyc_B', ['tsk_cyc_C']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });

      // C depends on A: would create A→B→C→A cycle
      expect(depsManager.wouldCreateCycle('tsk_cyc_C', ['tsk_cyc_A'])).toBe(true);
    });

    it('returns false for unrelated tasks', async () => {
      const taskX = makeTask('tsk_X', []);
      const taskY = makeTask('tsk_Y', []);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskX.id, payload: { task: taskX } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskY.id, payload: { task: taskY } });

      expect(depsManager.wouldCreateCycle('tsk_Z', ['tsk_X', 'tsk_Y'])).toBe(false);
    });
  });

  describe('computeBlockedBy', () => {
    it('returns empty array when no dependencies', async () => {
      const task = makeTask('tsk_nodep');
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: task.id, payload: { task } });

      const blocked = depsManager.computeBlockedBy(task);
      expect(blocked).toHaveLength(0);
    });

    it('returns blocking task id when dependency is not completed', async () => {
      const taskA = makeTask('tsk_dep_A', [], 'running');
      const taskB = makeTask('tsk_dep_B', ['tsk_dep_A']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });

      const blocked = depsManager.computeBlockedBy(taskB);
      expect(blocked).toContain('tsk_dep_A');
    });

    it('returns empty when all dependencies are completed', async () => {
      const taskA = makeTask('tsk_cdep_A', [], 'completed');
      const taskB = makeTask('tsk_cdep_B', ['tsk_cdep_A']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });

      // Simulate completion
      await stateManager.appendEvent({ type: 'TASK_COMPLETED', taskId: taskA.id, payload: { completedAt: new Date().toISOString() } });

      const blocked = depsManager.computeBlockedBy(taskB);
      expect(blocked).toHaveLength(0);
    });

    it('returns multiple blocking tasks', async () => {
      const taskA = makeTask('tsk_mba_A', [], 'running');
      const taskB = makeTask('tsk_mba_B', [], 'queued');
      const taskC = makeTask('tsk_mba_C', ['tsk_mba_A', 'tsk_mba_B']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskC.id, payload: { task: taskC } });

      const blocked = depsManager.computeBlockedBy(taskC);
      expect(blocked).toHaveLength(2);
      expect(blocked).toContain('tsk_mba_A');
      expect(blocked).toContain('tsk_mba_B');
    });
  });

  describe('topologicalOrder', () => {
    it('returns valid topological order', async () => {
      const taskA = makeTask('tsk_topo_A', []);
      const taskB = makeTask('tsk_topo_B', ['tsk_topo_A']);
      const taskC = makeTask('tsk_topo_C', ['tsk_topo_B']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskC.id, payload: { task: taskC } });

      const order = depsManager.topologicalOrder();
      const idxA = order.indexOf('tsk_topo_A');
      const idxB = order.indexOf('tsk_topo_B');
      const idxC = order.indexOf('tsk_topo_C');

      expect(idxA).toBeLessThan(idxB);
      expect(idxB).toBeLessThan(idxC);
    });

    it('returns all task ids', async () => {
      const taskA = makeTask('tsk_all_A', []);
      const taskB = makeTask('tsk_all_B', []);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });

      const order = depsManager.topologicalOrder();
      expect(order).toContain('tsk_all_A');
      expect(order).toContain('tsk_all_B');
    });
  });

  describe('getDAG', () => {
    it('returns nodes and edges', async () => {
      const taskA = makeTask('tsk_dag_A', []);
      const taskB = makeTask('tsk_dag_B', ['tsk_dag_A']);
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });

      const dag = depsManager.getDAG();
      expect(dag.nodes.some(n => n.id === 'tsk_dag_A')).toBe(true);
      expect(dag.nodes.some(n => n.id === 'tsk_dag_B')).toBe(true);
      expect(dag.edges.some(e => e.from === 'tsk_dag_B' && e.to === 'tsk_dag_A')).toBe(true);
    });

    it('returns empty nodes and edges for empty state', () => {
      const dag = depsManager.getDAG();
      expect(dag.nodes).toHaveLength(0);
      expect(dag.edges).toHaveLength(0);
    });

    it('returns subtree when rootId given', async () => {
      const taskA = makeTask('tsk_sub_A', []);
      const taskB = makeTask('tsk_sub_B', ['tsk_sub_A']);
      const taskC = makeTask('tsk_sub_C', []);  // unrelated
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskA.id, payload: { task: taskA } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskB.id, payload: { task: taskB } });
      await stateManager.appendEvent({ type: 'TASK_ADDED', taskId: taskC.id, payload: { task: taskC } });

      const dag = depsManager.getDAG('tsk_sub_B');
      expect(dag.nodes.some(n => n.id === 'tsk_sub_A')).toBe(true);
      expect(dag.nodes.some(n => n.id === 'tsk_sub_B')).toBe(true);
      // Unrelated task not included
      expect(dag.nodes.some(n => n.id === 'tsk_sub_C')).toBe(false);
    });
  });
});
