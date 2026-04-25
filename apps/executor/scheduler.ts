/**
 * Scheduler — pure function.
 * Given queue state + running set + capacity config, returns ordered list of
 * task IDs to start next tick. No side effects; fully unit-testable.
 */

export interface SchedulerTask {
  id: string;
  status: string;
  domainSlug: string | null;
  dependsOn: string[];  // parsed JSON array of task IDs
  paused: boolean;
  attemptCount: number;
  createdAt: string;
  priority?: number;
}

export interface RunningEntry {
  taskId: string;
  domainSlug: string | null;
}

export interface SchedulerConfig {
  maxConcurrent: number;
  maxPerDomainConcurrent: number;
  circuitBreakerThreshold: number;
}

export interface SchedulerInput {
  queue: SchedulerTask[];        // all tasks with status='queued'
  running: RunningEntry[];       // currently dispatched tasks
  doneIds: Set<string>;          // all completed/cancelled task IDs (for dep resolution)
  config: SchedulerConfig;
}

export interface SchedulerResult {
  toStart: string[];
  skipped: Array<{ id: string; reason: string }>;
}

export function schedule(input: SchedulerInput): SchedulerResult {
  const { queue, running, doneIds, config } = input;
  const toStart: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  const runningCount = running.length;
  if (runningCount >= config.maxConcurrent) {
    return { toStart: [], skipped: [] };
  }

  // Count running per domain
  const domainRunning = new Map<string, number>();
  for (const r of running) {
    if (r.domainSlug) {
      domainRunning.set(r.domainSlug, (domainRunning.get(r.domainSlug) ?? 0) + 1);
    }
  }

  // Track IDs we decided to start in this tick (for capacity accounting)
  const startingNow = new Set<string>();
  const startingNowByDomain = new Map<string, number>();

  // Sort: lower priority number = higher priority, then FIFO by createdAt
  const sorted = [...queue].sort((a, b) => {
    const pa = a.priority ?? 3;
    const pb = b.priority ?? 3;
    if (pa !== pb) return pa - pb;
    return a.createdAt.localeCompare(b.createdAt);
  });

  let slotsLeft = config.maxConcurrent - runningCount;

  for (const task of sorted) {
    if (slotsLeft <= 0) break;

    // Skip paused (circuit-broken) tasks
    if (task.paused) {
      skipped.push({ id: task.id, reason: 'paused (circuit breaker)' });
      continue;
    }

    // Skip if already running (shouldn't happen, but guard)
    if (running.some(r => r.taskId === task.id)) continue;

    // Check deps: all must be in doneIds
    const unmetDeps = task.dependsOn.filter(depId => !doneIds.has(depId));
    if (unmetDeps.length > 0) {
      skipped.push({ id: task.id, reason: `waiting for deps: ${unmetDeps.join(', ')}` });
      continue;
    }

    // Domain cap check
    if (task.domainSlug) {
      const currentDomainRunning = (domainRunning.get(task.domainSlug) ?? 0)
        + (startingNowByDomain.get(task.domainSlug) ?? 0);
      if (currentDomainRunning >= config.maxPerDomainConcurrent) {
        skipped.push({ id: task.id, reason: `domain cap hit (${task.domainSlug})` });
        continue;
      }
    }

    // Eligible — schedule it
    toStart.push(task.id);
    startingNow.add(task.id);
    if (task.domainSlug) {
      startingNowByDomain.set(task.domainSlug, (startingNowByDomain.get(task.domainSlug) ?? 0) + 1);
    }
    slotsLeft--;
  }

  return { toStart, skipped };
}
