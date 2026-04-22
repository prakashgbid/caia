/**
 * Monitor stub — provides types used by completion-hook.ts.
 */

import type { DispatchHandle } from './dispatcher';

export interface WorkerOutcome {
  kind: 'done' | 'failed' | 'timed_out' | 'stalled' | 'dead';
  exitCode: number | null;
  lastOutputAge: number;
}

export interface MonitoredWorker {
  handle: DispatchHandle;
  outcome: WorkerOutcome;
}
