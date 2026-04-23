/**
 * Worker monitor — polls child processes for completion/stall.
 */

import type { DispatchHandle } from './dispatcher';

const STALL_TIMEOUT_MS = 20 * 60 * 1000; // 20 min

export interface WorkerOutcome {
  kind: 'done' | 'failed' | 'timed_out' | 'stalled' | 'dead';
  exitCode: number | null;
  lastOutputAge: number;
}

export interface MonitoredWorker {
  handle: DispatchHandle;
  outcome: WorkerOutcome;
}

export function createMonitor(): MonitoredWorker[] {
  return [];
}

export function addWorker(workers: MonitoredWorker[], handle: DispatchHandle): void {
  workers.push({ handle, outcome: { kind: 'done', exitCode: null, lastOutputAge: 0 } });
}

export function pollWorkers(workers: MonitoredWorker[]): MonitoredWorker[] {
  const now = Date.now();
  const finished: MonitoredWorker[] = [];
  for (const w of workers) {
    const proc = w.handle.process;
    const code = proc.exitCode;
    if (code !== null || proc.killed) {
      finished.push({ handle: w.handle, outcome: { kind: code === 0 ? 'done' : 'failed', exitCode: code, lastOutputAge: 0 } });
    } else {
      const elapsed = now - new Date(w.handle.startedAt).getTime();
      if (elapsed > STALL_TIMEOUT_MS) {
        finished.push({ handle: w.handle, outcome: { kind: 'stalled', exitCode: null, lastOutputAge: elapsed } });
      }
    }
  }
  return finished;
}

export function removeFinished(workers: MonitoredWorker[], finished: MonitoredWorker[]): MonitoredWorker[] {
  const done = new Set(finished.map(w => w.handle.taskId));
  return workers.filter(w => !done.has(w.handle.taskId));
}

export function killWorker(worker: MonitoredWorker): void {
  try { worker.handle.process.kill('SIGKILL'); } catch { /* best effort */ }
}
