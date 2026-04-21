import type { Task } from './types';
import type { StateManager } from './state';

export class DepsManager {
  constructor(private readonly state: StateManager) {}

  wouldCreateCycle(newTaskId: string, dependsOn: string[]): boolean {
    // For each proposed dependency, check if newTaskId is reachable from it
    // (i.e., if the dependency already depends on newTaskId transitively)
    for (const depId of dependsOn) {
      if (this.isReachable(depId, newTaskId, new Set())) {
        return true;
      }
    }
    return false;
  }

  private isReachable(fromId: string, targetId: string, visited: Set<string>): boolean {
    if (fromId === targetId) return true;
    if (visited.has(fromId)) return false;
    visited.add(fromId);

    const task = this.state.getTask(fromId);
    if (!task) return false;

    for (const depId of task.dependsOn) {
      if (this.isReachable(depId, targetId, visited)) return true;
    }
    return false;
  }

  computeBlockedBy(task: Task): string[] {
    if (task.dependsOn.length === 0) return [];
    return task.dependsOn.filter((depId) => {
      const dep = this.state.getTask(depId);
      if (!dep) return false;
      return dep.status !== 'completed';
    });
  }

  topologicalOrder(): string[] {
    const tasks = this.state.listTasks();
    const inDegree = new Map<string, number>();
    const adjList = new Map<string, string[]>();

    for (const task of tasks) {
      if (!inDegree.has(task.id)) inDegree.set(task.id, 0);
      if (!adjList.has(task.id)) adjList.set(task.id, []);
    }

    for (const task of tasks) {
      for (const depId of task.dependsOn) {
        if (!adjList.has(depId)) adjList.set(depId, []);
        adjList.get(depId)!.push(task.id);
        inDegree.set(task.id, (inDegree.get(task.id) ?? 0) + 1);
      }
    }

    const queue: string[] = [];
    for (const [id, degree] of inDegree.entries()) {
      if (degree === 0) queue.push(id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      order.push(current);
      for (const neighbor of adjList.get(current) ?? []) {
        const newDegree = (inDegree.get(neighbor) ?? 0) - 1;
        inDegree.set(neighbor, newDegree);
        if (newDegree === 0) queue.push(neighbor);
      }
    }

    return order;
  }

  getDAG(rootId?: string): { nodes: Task[]; edges: Array<{ from: string; to: string }> } {
    const allTasks = this.state.listTasks();
    const edges: Array<{ from: string; to: string }> = [];

    for (const task of allTasks) {
      for (const depId of task.dependsOn) {
        edges.push({ from: task.id, to: depId });
      }
    }

    if (!rootId) {
      return { nodes: allTasks, edges };
    }

    // Return subtree rooted at rootId (the node and everything it depends on)
    const included = new Set<string>();
    this.collectSubtree(rootId, included);
    const nodes = allTasks.filter((t) => included.has(t.id));
    const filteredEdges = edges.filter(
      (e) => included.has(e.from) && included.has(e.to),
    );
    return { nodes, edges: filteredEdges };
  }

  private collectSubtree(taskId: string, visited: Set<string>): void {
    if (visited.has(taskId)) return;
    visited.add(taskId);
    const task = this.state.getTask(taskId);
    if (!task) return;
    for (const depId of task.dependsOn) {
      this.collectSubtree(depId, visited);
    }
  }
}
