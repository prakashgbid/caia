#!/usr/bin/env node
/**
 * Executor daemon — main loop.
 * Every pollIntervalMs: scheduler → dispatcher → (monitor runs independently).
 * Manages heartbeat file. Recovers in-flight runs on restart.
 * Does NOT auto-start: user must run `conductor exec start` explicitly.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { schedule } from './scheduler';
import { dispatch } from './dispatcher';
import {
  createMonitor,
  addWorker,
  pollWorkers,
  removeFinished,
  killWorker,
} from './monitor';
import { handleCompletion } from './completion-hook';
import type { MonitoredWorker } from './monitor';

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';
const HEARTBEAT_FILE = path.join(os.homedir(), '.conductor', 'executor.heartbeat');
const WORKTREE_BASE = process.env['CONDUCTOR_WORKTREE_BASE']
  ?? path.join(os.homedir(), 'Documents', 'projects', 'conductor', '.claude', 'worktrees');

interface ExecutorConfigRow {
  enabled: boolean;
  maxConcurrent: number;
  maxPerDomainConcurrent: number;
  circuitBreakerThreshold: number;
  pollIntervalMs: number;
  monitorIntervalMs: number;
  maxTurns: number;
  permissionMode: string;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  cwd: string;
  declaredFiles: string;
  dependsOn: string;
  notes: string | null;
  projectId: string | null;
  domainSlug: string | null;
  attemptCount: number;
  paused: boolean;
  createdAt: string;
}

async function fetchConfig(): Promise<ExecutorConfigRow | null> {
  try {
    const res = await fetch(`${API_BASE}/executor/config`);
    if (!res.ok) return null;
    return await res.json() as ExecutorConfigRow;
  } catch {
    return null;
  }
}

async function fetchQueuedTasks(): Promise<TaskRow[]> {
  try {
    const res = await fetch(`${API_BASE}/tasks?status=queued`);
    if (!res.ok) return [];
    return await res.json() as TaskRow[];
  } catch {
    return [];
  }
}

async function fetchDoneTaskIds(): Promise<Set<string>> {
  try {
    const res = await fetch(`${API_BASE}/tasks?status=completed,cancelled,failed`);
    if (!res.ok) return new Set();
    const tasks = await res.json() as Array<{ id: string }>;
    return new Set(tasks.map(t => t.id));
  } catch {
    return new Set();
  }
}

async function fetchTaskDetail(taskId: string): Promise<TaskRow | null> {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`);
    if (!res.ok) return null;
    return await res.json() as TaskRow;
  } catch {
    return null;
  }
}

function writeHeartbeat(running: number, queued: number): void {
  try {
    const data = JSON.stringify({
      at: new Date().toISOString(),
      pid: process.pid,
      running,
      queued,
    });
    fs.writeFileSync(HEARTBEAT_FILE, data);
  } catch { /* best effort */ }
}

async function recoverInFlight(): Promise<void> {
  // On restart, find any executor_runs with status=running where PID is dead
  try {
    const res = await fetch(`${API_BASE}/executor/runs?status=running`);
    if (!res.ok) return;
    const runs = await res.json() as Array<{ id: number; task_id: string; pid: number | null }>;

    for (const run of runs) {
      let pidAlive = false;
      if (run.pid) {
        try {
          process.kill(run.pid, 0);
          pidAlive = true;
        } catch { /* dead */ }
      }

      if (!pidAlive) {
        // Mark run as killed, re-queue task
        await fetch(`${API_BASE}/executor/runs/${run.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            status: 'killed',
            failure_reason: 'Process not found on executor restart',
            ended_at: new Date().toISOString(),
          }),
        });

        await fetch(`${API_BASE}/tasks/${run.task_id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: 'queued' }),
        });

        console.log(`[executor:daemon] Recovered task ${run.task_id} (PID ${run.pid} dead)`);
      }
    }
  } catch { /* non-fatal */ }
}

async function tick(
  monitored: MonitoredWorker[],
  config: ExecutorConfigRow,
): Promise<{ workers: MonitoredWorker[]; dispatched: number }> {
  // 1. Poll existing workers for completion
  const finished = pollWorkers(monitored);
  for (const worker of finished) {
    console.log(`[executor:daemon] Worker done: task=${worker.handle.taskId} outcome=${worker.outcome.kind}`);
    await handleCompletion(worker, { circuitBreakerThreshold: config.circuitBreakerThreshold });

    if (worker.outcome.kind === 'stalled') {
      killWorker(worker);
    }
  }
  const stillRunning = removeFinished(monitored, finished);

  // 2. Fetch queue state
  const [queued, doneIds] = await Promise.all([fetchQueuedTasks(), fetchDoneTaskIds()]);

  // 3. Schedule next batch
  const schedulerResult = schedule({
    queue: queued.map(t => ({
      id: t.id,
      status: t.status,
      domainSlug: t.domainSlug,
      dependsOn: safeParseJson<string[]>(t.dependsOn, []),
      paused: t.paused,
      attemptCount: t.attemptCount,
      createdAt: t.createdAt,
    })),
    running: stillRunning.map((w: MonitoredWorker) => ({
      taskId: w.handle.taskId,
      domainSlug: null,  // resolved below if needed
    })),
    doneIds,
    config: {
      maxConcurrent: config.maxConcurrent,
      maxPerDomainConcurrent: config.maxPerDomainConcurrent,
      circuitBreakerThreshold: config.circuitBreakerThreshold,
    },
  });

  if (schedulerResult.skipped.length > 0 && process.env['EXECUTOR_DEBUG']) {
    for (const s of schedulerResult.skipped) {
      console.log(`[executor:daemon] Skipped ${s.id}: ${s.reason}`);
    }
  }

  // 4. Dispatch scheduled tasks
  let dispatchedThisTick = 0;
  for (const taskId of schedulerResult.toStart) {
    const task = queued.find(t => t.id === taskId);
    if (!task) continue;

    console.log(`[executor:daemon] Dispatching task ${taskId}: ${task.title}`);

    try {
      const handle = await dispatch(
        {
          id: task.id,
          title: task.title,
          cwd: task.cwd || os.homedir(),
          notes: task.notes,
          declaredFiles: safeParseJson<string[]>(task.declaredFiles, []),
          domainSlug: task.domainSlug,
          projectId: task.projectId,
        },
        {
          maxTurns: config.maxTurns,
          permissionMode: config.permissionMode,
          worktreeBaseDir: WORKTREE_BASE,
        },
        task.attemptCount + 1,
      );

      addWorker(stillRunning, handle);
      dispatchedThisTick++;
      console.log(`[executor:daemon] Spawned task ${taskId} (PID ${handle.pid})`);
    } catch (err) {
      console.error(`[executor:daemon] Failed to dispatch task ${taskId}:`, err instanceof Error ? err.message : err);
    }
  }

  writeHeartbeat(stillRunning.length, queued.length);
  return { workers: stillRunning, dispatched: dispatchedThisTick };
}

function safeParseJson<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try { return JSON.parse(s) as T; } catch { return fallback; }
}

async function main(): Promise<void> {
  const DRAIN_LIMIT = process.env['EXECUTOR_DRAIN_LIMIT'] ? parseInt(process.env['EXECUTOR_DRAIN_LIMIT'], 10) : null;
  let totalDispatched = 0;
  let drainLimitReached = false;

  console.log(`[executor:daemon] Starting. PID=${process.pid}, API=${API_BASE}${DRAIN_LIMIT ? `, drain-limit=${DRAIN_LIMIT}` : ''}`);

  // Recover any in-flight tasks from previous run
  await recoverInFlight();

  const monitored: MonitoredWorker[] = [];

  // Graceful shutdown
  let shuttingDown = false;
  process.on('SIGTERM', () => {
    console.log('[executor:daemon] SIGTERM received, shutting down...');
    shuttingDown = true;
  });
  process.on('SIGINT', () => {
    console.log('[executor:daemon] SIGINT received, shutting down...');
    shuttingDown = true;
    process.exit(0);
  });

  let currentMonitored = monitored;

  const runTick = async () => {
    if (shuttingDown) return;

    const config = await fetchConfig();
    if (!config) {
      console.log('[executor:daemon] Could not fetch config — API down?');
      writeHeartbeat(0, -1);
      return;
    }

    if (!config.enabled) {
      writeHeartbeat(currentMonitored.length, -1);
      return;
    }

    // When drain limit reached: only reap existing workers, no new dispatches
    if (drainLimitReached) {
      const finished = pollWorkers(currentMonitored);
      for (const worker of finished) {
        await handleCompletion(worker, { circuitBreakerThreshold: config.circuitBreakerThreshold });
        if (worker.outcome.kind === 'stalled') killWorker(worker);
      }
      currentMonitored = removeFinished(currentMonitored, finished);
      if (currentMonitored.length === 0) {
        console.log(`[executor:daemon] Drain complete. Dispatched=${totalDispatched}, all workers finished. Exiting.`);
        process.exit(0);
      }
      console.log(`[executor:daemon] Drain waiting: ${currentMonitored.length} workers still running...`);
      return;
    }

    try {
      const result = await tick(currentMonitored, config);
      currentMonitored = result.workers;
      totalDispatched += result.dispatched;

      if (DRAIN_LIMIT !== null && totalDispatched >= DRAIN_LIMIT) {
        drainLimitReached = true;
        console.log(`[executor:daemon] Drain limit reached (${totalDispatched}/${DRAIN_LIMIT}). Will wait for ${currentMonitored.length} running workers.`);
      }
    } catch (err) {
      console.error('[executor:daemon] Tick error:', err instanceof Error ? err.message : err);
    }
  };

  // Initial tick
  await runTick();

  // Fetch initial config for interval
  const initialConfig = await fetchConfig();
  const pollMs = initialConfig?.pollIntervalMs ?? 10_000;

  const interval = setInterval(runTick, pollMs);

  process.on('exit', () => {
    clearInterval(interval);
    try { fs.unlinkSync(HEARTBEAT_FILE); } catch { /* best effort */ }
  });
}

main().catch(err => {
  console.error('[executor:daemon] Fatal:', err);
  process.exit(1);
});
