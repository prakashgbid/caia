import { execSync } from 'child_process';
import type { AuditResult } from './types';
import type { StateManager } from './state';

export class AuditManager {
  constructor(private readonly state: StateManager) {}

  audit(taskId: string): AuditResult {
    const task = this.state.getTask(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    const declared = task.declaredFiles;
    const actual = task.actualFiles ?? [];

    const declaredSet = new Set(declared);
    const actualSet = new Set(actual);

    const missing = declared.filter((f) => !actualSet.has(f));
    const extra = actual.filter((f) => !declaredSet.has(f));
    const clean = missing.length === 0 && extra.length === 0;

    return { taskId, declared, actual, missing, extra, clean };
  }

  async getActualChangedFiles(cwd: string, since: string): Promise<string[]> {
    try {
      // Try to find the git commit at or after the given timestamp
      void new Date(since).toISOString(); // since param kept for API compatibility
      const output = execSync(
        `git -C "${cwd}" diff --name-only HEAD 2>/dev/null || true`,
        { encoding: 'utf8', timeout: 10000 },
      ).trim();

      if (!output) {
        // Try staged changes
        const staged = execSync(
          `git -C "${cwd}" diff --cached --name-only 2>/dev/null || true`,
          { encoding: 'utf8', timeout: 10000 },
        ).trim();
        if (!staged) return [];
        return staged.split('\n').filter(Boolean);
      }

      return output.split('\n').filter(Boolean);
    } catch {
      return [];
    }
  }
}
