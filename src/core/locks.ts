import picomatch from 'picomatch';
import type { CheckResult, ConflictInfo, Task } from './types';
import type { StateManager } from './state';

const DEFAULT_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

export class LockManager {
  constructor(private readonly state: StateManager) {}

  check(files: string[]): CheckResult {
    const runningTasks = this.state.listTasks({ status: 'running' });
    const conflicts: ConflictInfo[] = [];

    for (const file of files) {
      for (const task of runningTasks) {
        for (const glob of task.declaredFiles) {
          if (this.matchesGlob(file, glob)) {
            conflicts.push({
              file,
              matchedGlob: glob,
              taskId: task.id,
              taskTitle: task.title,
              taskStatus: task.status,
            });
          }
        }
      }
    }

    return { clean: conflicts.length === 0, conflicts };
  }

  getLocksFor(filePattern: string): Task[] {
    const runningTasks = this.state.listTasks({ status: 'running' });
    return runningTasks.filter((task) =>
      task.declaredFiles.some((glob) => this.matchesGlob(filePattern, glob)),
    );
  }

  matchesGlob(filePath: string, globPattern: string): boolean {
    const isMatch = picomatch(globPattern, { dot: true });
    return isMatch(filePath);
  }

  getExpiredTasks(ttlMs: number = DEFAULT_TTL_MS): Task[] {
    const runningTasks = this.state.listTasks({ status: 'running' });
    const now = Date.now();
    return runningTasks.filter((task) => {
      if (!task.startedAt) return false;
      const startedMs = new Date(task.startedAt).getTime();
      return now - startedMs > ttlMs;
    });
  }
}
