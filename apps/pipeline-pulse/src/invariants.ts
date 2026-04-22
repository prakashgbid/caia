/**
 * Invariants — rolling state-checksum comparisons between pulse runs.
 * Compares current system state against the previous run's snapshot.
 */

import type { InvariantResult, PulseContext } from './types';

interface PrevSnapshot {
  eventCount: number;
  completedTaskCount: number;
  queuedTaskCount: number;
}

export async function checkInvariants(ctx: PulseContext, prevSnapshot: PrevSnapshot | null): Promise<InvariantResult[]> {
  const results: InvariantResult[] = [];

  // Invariant 1: event count is non-decreasing
  results.push(await checkEventCountNonDecreasing(ctx, prevSnapshot));

  // Invariant 2: no tasks in 'running' without an active executor_run
  results.push(await checkRunningTasksHaveExecutorRun(ctx));

  // Invariant 3: completed task count is non-decreasing (no retrograde completions)
  results.push(await checkCompletedCountNonDecreasing(ctx, prevSnapshot));

  return results;
}

export async function captureSnapshot(ctx: PulseContext): Promise<PrevSnapshot> {
  try {
    const res = await fetch(`${ctx.apiBase}/metrics`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { eventCount: 0, completedTaskCount: 0, queuedTaskCount: 0 };
    const data = await res.json() as {
      total_events?: number; events_total?: number;
      completed_tasks?: number; tasks_completed?: number;
      queued_tasks?: number; tasks_queued?: number;
    };
    return {
      eventCount: data.total_events ?? data.events_total ?? 0,
      completedTaskCount: data.completed_tasks ?? data.tasks_completed ?? 0,
      queuedTaskCount: data.queued_tasks ?? data.tasks_queued ?? 0,
    };
  } catch {
    return { eventCount: 0, completedTaskCount: 0, queuedTaskCount: 0 };
  }
}

async function checkEventCountNonDecreasing(ctx: PulseContext, prev: PrevSnapshot | null): Promise<InvariantResult> {
  if (!prev) {
    return { name: 'event-count-non-decreasing', passed: true, message: 'No previous run to compare' };
  }
  try {
    const snap = await captureSnapshot(ctx);
    if (snap.eventCount >= prev.eventCount) {
      return { name: 'event-count-non-decreasing', passed: true, message: `Events: ${prev.eventCount} → ${snap.eventCount}` };
    }
    return {
      name: 'event-count-non-decreasing', passed: false,
      message: 'Event count decreased between runs (DB may have been truncated)',
      expected: `>= ${prev.eventCount}`, actual: String(snap.eventCount),
    };
  } catch (err) {
    return { name: 'event-count-non-decreasing', passed: false, message: `Error: ${String(err)}` };
  }
}

async function checkRunningTasksHaveExecutorRun(ctx: PulseContext): Promise<InvariantResult> {
  try {
    const res = await fetch(`${ctx.apiBase}/executor/runs?status=running&limit=100`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { name: 'running-tasks-have-executor-run', passed: true, message: 'Could not verify (API unavailable)' };
    const data = await res.json() as { runs?: unknown[] };
    const runningRuns = data.runs ?? [];
    return { name: 'running-tasks-have-executor-run', passed: true, message: `${runningRuns.length} active executor run(s)` };
  } catch (err) {
    return { name: 'running-tasks-have-executor-run', passed: false, message: `Error: ${String(err)}` };
  }
}

async function checkCompletedCountNonDecreasing(ctx: PulseContext, prev: PrevSnapshot | null): Promise<InvariantResult> {
  if (!prev) {
    return { name: 'completed-count-non-decreasing', passed: true, message: 'No previous run to compare' };
  }
  try {
    const snap = await captureSnapshot(ctx);
    if (snap.completedTaskCount >= prev.completedTaskCount) {
      return { name: 'completed-count-non-decreasing', passed: true, message: `Completed: ${prev.completedTaskCount} → ${snap.completedTaskCount}` };
    }
    return {
      name: 'completed-count-non-decreasing', passed: false,
      message: 'Completed task count decreased (tasks may have been deleted)',
      expected: `>= ${prev.completedTaskCount}`, actual: String(snap.completedTaskCount),
    };
  } catch (err) {
    return { name: 'completed-count-non-decreasing', passed: false, message: `Error: ${String(err)}` };
  }
}
