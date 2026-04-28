/**
 * Completion hook — called after a worker finishes.
 * Determines outcome, updates task status, fires completeness sentinel,
 * and re-queues on failure (or trips breaker).
 */

import * as child_process from 'child_process';
import type { MonitoredWorker } from './monitor';
import { parseClaudeOutput, cleanupWorktree } from './dispatcher';
import { checkAndBreak } from './breaker';
import { publishEvent } from './publish-event';
import { parseClaudeOutputRich } from './parse-claude-output-rich';

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

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
  rootPromptId: string | null;
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

  // Rich telemetry: tool calls, token usage, files changed
  const rich = parseClaudeOutputRich(handle.outputLines);
  const durationMs = Date.now() - new Date(handle.startedAt).getTime();

  const task = await fetchTask(handle.taskId);
  if (!task) {
    console.log(`[executor:hook] Task ${handle.taskId} not found — skipping completion hook`);
    return;
  }

  const newAttemptCount = task.attemptCount + 1;

  if (outcome.kind === 'done' && outcome.exitCode === 0 && parsed.resultOk) {
    // ── Success path ──────────────────────────────────────────────────────────
    console.log(`[executor:hook] Task ${handle.taskId} completed successfully`);

    await finalizeExecutorRun(
      handle.executorRunId, parsed.sessionId, 'done',
      parsed.summary, null, parsed.costUsd, parsed.turnCount,
    );

    await markTaskDone(handle.taskId, parsed.sessionId);

    // Legacy events (retained for existing consumers)
    await publishEvent('task.completed', { task_id: handle.taskId, duration_ms: durationMs, result_summary: parsed.summary }, { correlationId: task.rootPromptId, entityType: 'task', entityId: handle.taskId });
    await publishEvent('worker.completed', { executor_run_id: handle.executorRunId, task_id: handle.taskId, exit_code: outcome.exitCode ?? 0, turn_count: parsed.turnCount }, { correlationId: task.rootPromptId, entityType: 'task', entityId: handle.taskId });

    // Per-tool-call events (fire-and-forget — no await)
    for (const tc of rich.toolCalls) {
      void publishEvent('executor.claude.tool_call', {
        taskId: handle.taskId,
        executorRunId: handle.executorRunId,
        toolName: tc.name,
        inputSummary: tc.inputSummary,
        sequenceIndex: tc.sequenceIndex,
      });
    }

    // Structured completion event
    await publishEvent('executor.claude.completed', {
      taskId: handle.taskId,
      executorRunId: handle.executorRunId,
      rootPromptId: task.rootPromptId ?? null,
      sessionId: parsed.sessionId,
      exitCode: outcome.exitCode ?? 0,
      inputTokens: rich.inputTokens,
      outputTokens: rich.outputTokens,
      filesChanged: rich.filesChanged,
      toolCallCount: rich.toolCallCount,
      durationMs,
      costUsd: parsed.costUsd,
      turnCount: parsed.turnCount,
    });

    await publishEvent('pipeline.stage.advanced', {
      rootPromptId: task.rootPromptId ?? null,
      stage: 'task_completed',
      entityKind: 'task',
      entityId: handle.taskId,
      durationFromStartMs: durationMs,
    });

    // PATCH task_run with executor telemetry (best-effort; run may not exist yet if poller hasn't fired)
    if (parsed.sessionId) {
      try {
        await fetch(`${API_BASE}/task-runs/${parsed.sessionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            executor_pid: handle.pid,
            worktree_path: handle.worktreePath,
            tool_call_count: rich.toolCallCount,
            input_tokens: rich.inputTokens,
            output_tokens: rich.outputTokens,
            files_changed: JSON.stringify(rich.filesChanged),
            duration_ms: durationMs,
            raw_claude_output: handle.outputLines.join('\n').slice(0, 50_000),
          }),
        });
      } catch { /* non-fatal — task_run may not exist yet */ }
    }

    await runCompletenessCheck(task.cwd);

    // Trigger Testing Agent (Tier 4) — validate the implementation non-fatally
    if (parsed.sessionId) {
      try {
        const testResponse = await fetch(`${API_BASE}/agents/testing/run`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            taskId: handle.taskId,
            taskRunId: parsed.sessionId,
            promptId: task.rootPromptId ?? null,
            correlationId: `test-${parsed.sessionId}`,
          }),
        });
        if (!testResponse.ok) {
          console.log(`[executor:hook] Testing agent trigger returned ${testResponse.status}`);
        }
      } catch { /* non-fatal — testing agent is observability, not critical path */ }
    }

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
            tool_call_count: rich.toolCallCount,
            duration_ms: durationMs,
          },
        }),
      });
    } catch { /* non-fatal */ }

    // Clean up worktree on success
    cleanupWorktree(handle.worktreePath);

  } else {
    // ── Failure path ──────────────────────────────────────────────────────────
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

    // Check circuit breaker before emitting events so we can include tripped status
    const tripped = await checkAndBreak(
      task.id,
      task.title,
      newAttemptCount,
      config.circuitBreakerThreshold,
      reason,
    );

    // Legacy events (retained for existing consumers)
    await publishEvent('task.failed', { task_id: handle.taskId, failure_reason: reason, attempt_n: newAttemptCount }, { correlationId: task.rootPromptId, entityType: 'task', entityId: handle.taskId });
    await publishEvent('worker.failed', { executor_run_id: handle.executorRunId, task_id: handle.taskId, exit_code: outcome.exitCode ?? -1, failure_reason: reason }, { correlationId: task.rootPromptId, entityType: 'task', entityId: handle.taskId });

    // Structured failure event
    await publishEvent('executor.task.failed', {
      taskId: handle.taskId,
      executorRunId: handle.executorRunId,
      rootPromptId: task.rootPromptId ?? null,
      error: reason,
      exitCode: outcome.exitCode ?? -1,
      retryCount: newAttemptCount - 1,
      circuitBreakerTripped: tripped,
      durationMs,
      toolCallCount: rich.toolCallCount,
      inputTokens: rich.inputTokens,
      outputTokens: rich.outputTokens,
    });

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
