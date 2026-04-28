/**
 * Completion hook — called after a worker finishes.
 * Determines outcome, updates task status, fires completeness sentinel,
 * and re-queues on failure (or trips breaker).
 */

import * as child_process from 'child_process';
import type { MonitoredWorker } from './monitor';
import { parseClaudeOutput, cleanupWorktree } from './dispatcher';
import { checkAndBreak } from './breaker';

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

interface EmitOptions {
  correlationId?: string | null;
  taskId?: string;
}

async function emitEvent(
  type: string,
  payload: Record<string, unknown>,
  opts: EmitOptions = {},
): Promise<void> {
  try {
    await fetch(`${API_BASE}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        actor: 'executor',
        // Stamp every executor-emitted event with the originating prompt's
        // correlation_id (DASH-107) so /prompts/:id/journey can build a
        // complete trace across the executor boundary.
        correlation_id: opts.correlationId ?? undefined,
        entity_type: opts.taskId ? 'task' : undefined,
        entity_id: opts.taskId,
        payload,
      }),
    });
  } catch { /* non-fatal */ }
}

export interface HookConfig {
  circuitBreakerThreshold: number;
}

interface TaskRow {
  id: string;
  title: string;
  status: string;
  cwd: string;
  attemptCount: number;
  paused: boolean;
  // DASH-107: GET /tasks/:id returns the full row including the originating
  // prompt link. Used to stamp `correlation_id` on completion events.
  rootPromptId?: string | null;
}

async function fetchTask(taskId: string): Promise<TaskRow | null> {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`);
    if (!res.ok) return null;
    return await res.json() as TaskRow;
  } catch {
    return null;
  }
}

async function markTaskDone(taskId: string, sessionId: string | null): Promise<void> {
  await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'completed',
      completed_at: new Date().toISOString(),
      session_id: sessionId,
    }),
  });
}

async function markTaskFailed(
  taskId: string,
  reason: string,
  newAttemptCount: number,
): Promise<void> {
  await fetch(`${API_BASE}/tasks/${taskId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'queued',  // re-queue for retry
      attempt_count: newAttemptCount,
      notes: `Attempt ${newAttemptCount} failed: ${reason.slice(0, 500)}`,
    }),
  });
}

async function finalizeExecutorRun(
  executorRunId: number,
  sessionId: string | null,
  status: string,
  resultSummary: string,
  failureReason: string | null,
  costUsd: number | null,
  turnCount: number | null,
): Promise<void> {
  if (!executorRunId) return;
  try {
    await fetch(`${API_BASE}/executor/runs/${executorRunId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        status,
        result_summary: resultSummary,
        failure_reason: failureReason,
        cost_usd: costUsd,
        turn_count_at_end: turnCount,
        ended_at: new Date().toISOString(),
      }),
    });
  } catch { /* non-fatal */ }
}

async function runCompletenessCheck(cwd: string): Promise<boolean> {
  // Run gate:publish if available, then completeness sentinel
  try {
    const result = child_process.spawnSync(
      'npm',
      ['run', 'gate:publish', '--if-present'],
      { cwd, timeout: 120_000, stdio: 'pipe' },
    );
    if (result.status !== 0) {
      console.log(`[executor:hook] gate:publish failed in ${cwd}`);
      return false;
    }
  } catch {
    // gate:publish not available — skip, not a hard failure
  }

  // Trigger completeness check via API
  try {
    await fetch(`${API_BASE}/completeness/trigger`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ cwd }),
    });
  } catch { /* non-fatal */ }

  return true;
}

export async function handleCompletion(
  worker: MonitoredWorker,
  config: HookConfig,
): Promise<void> {
  const { handle, outcome } = worker;
  const parsed = parseClaudeOutput(handle.outputLines);

  const task = await fetchTask(handle.taskId);
  if (!task) {
    console.log(`[executor:hook] Task ${handle.taskId} not found — skipping completion hook`);
    return;
  }

  const newAttemptCount = task.attemptCount + 1;
  const correlationId = task.rootPromptId ?? null;
  const emitOpts: EmitOptions = { correlationId, taskId: handle.taskId };

  if (outcome.kind === 'done' && outcome.exitCode === 0 && parsed.resultOk) {
    // Success path
    console.log(`[executor:hook] Task ${handle.taskId} completed successfully`);

    await finalizeExecutorRun(
      handle.executorRunId, parsed.sessionId, 'done',
      parsed.summary, null, parsed.costUsd, parsed.turnCount,
    );

    await markTaskDone(handle.taskId, parsed.sessionId);
    await emitEvent('task.completed', { task_id: handle.taskId, duration_ms: Date.now() - new Date(handle.startedAt).getTime(), result_summary: parsed.summary }, emitOpts);
    await emitEvent('worker.completed', { executor_run_id: handle.executorRunId, task_id: handle.taskId, exit_code: outcome.exitCode ?? 0, turn_count: parsed.turnCount }, emitOpts);
    await runCompletenessCheck(task.cwd);

    // Write timeline event
    try {
      await fetch(`${API_BASE}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'task.completed',
          actor: 'executor',
          summary: `Task "${task.title}" completed by executor (attempt ${newAttemptCount})`,
          subject_id: task.id,
          subject_kind: 'task',
          payload: {
            session_id: parsed.sessionId,
            cost_usd: parsed.costUsd,
            attempt_n: newAttemptCount,
          },
        }),
      });
    } catch { /* non-fatal */ }

    // Clean up worktree on success
    cleanupWorktree(handle.worktreePath);

  } else {
    // Failure path
    const reason = outcome.kind === 'stalled'
      ? `stalled (no output for ${Math.round(outcome.lastOutputAge / 60000)}min)`
      : outcome.kind === 'dead'
      ? `process died (exit code: ${outcome.exitCode})`
      : `exit code ${(outcome as { exitCode: number }).exitCode}: ${parsed.summary.slice(0, 200)}`;

    console.log(`[executor:hook] Task ${handle.taskId} failed: ${reason}`);

    await finalizeExecutorRun(
      handle.executorRunId, parsed.sessionId, 'failed',
      parsed.summary, reason, parsed.costUsd, parsed.turnCount,
    );

    // Always update task status + attempt count first (moves out of 'running')
    await markTaskFailed(task.id, reason, newAttemptCount);
    await emitEvent('task.failed', { task_id: handle.taskId, failure_reason: reason, attempt_n: newAttemptCount }, emitOpts);
    await emitEvent('worker.failed', { executor_run_id: handle.executorRunId, task_id: handle.taskId, exit_code: outcome.exitCode ?? -1, failure_reason: reason }, emitOpts);

    // Check circuit breaker
    const tripped = await checkAndBreak(
      task.id,
      task.title,
      newAttemptCount,
      config.circuitBreakerThreshold,
      reason,
    );

    if (!tripped) {
      console.log(`[executor:hook] Task ${handle.taskId} re-queued (attempt ${newAttemptCount}/${config.circuitBreakerThreshold})`);
    }

    // Write timeline event
    try {
      await fetch(`${API_BASE}/timeline`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'task.failed',
          actor: 'executor',
          summary: `Task "${task.title}" failed (attempt ${newAttemptCount}): ${reason.slice(0, 100)}`,
          subject_id: task.id,
          subject_kind: 'task',
          payload: { reason, attempt_n: newAttemptCount, breaker_tripped: tripped },
        }),
      });
    } catch { /* non-fatal */ }

    // Leave worktree intact on failure for human review
  }
}
