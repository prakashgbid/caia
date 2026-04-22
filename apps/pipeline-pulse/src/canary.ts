/**
 * Canary — dispatches a synthetic task through the full pipeline and measures
 * end-to-end latency. If the task completes within timeout, the pipeline is live.
 *
 * The canary task uses a special notes marker so dispatcher builds a trivial prompt.
 */

import type { CanaryResult, PulseContext } from './types';

const CANARY_POLL_INTERVAL_MS = 1000;
const CANARY_TIMEOUT_MS = 25_000;

export async function runCanary(ctx: PulseContext): Promise<CanaryResult> {
  const dispatchedAt = new Date().toISOString();
  const canaryTitle = `[PULSE-CANARY] pulse-run-${ctx.runId}`;

  // Insert canary task via API
  let taskId: string | null = null;
  try {
    const res = await fetch(`${ctx.apiBase}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(5000),
      body: JSON.stringify({
        title: canaryTitle,
        cwd: ctx.conductorDir,
        files: [],
        spawnedBy: 'system',
        notes: JSON.stringify({ canary: true, pulseRunId: ctx.runId }),
      }),
    });

    if (!res.ok) {
      return {
        taskId: null,
        dispatchedAt,
        completedAt: null,
        elapsedMs: null,
        passed: false,
        message: `Failed to create canary task: HTTP ${res.status}`,
      };
    }

    const body = await res.json() as { id?: string; task?: { id: string } };
    taskId = body.id ?? body.task?.id ?? null;
    if (!taskId) {
      return { taskId: null, dispatchedAt, completedAt: null, elapsedMs: null, passed: false, message: 'No task id returned' };
    }
  } catch (err) {
    return { taskId: null, dispatchedAt, completedAt: null, elapsedMs: null, passed: false, message: `API error: ${String(err)}` };
  }

  // Poll until completed or timeout
  const deadline = Date.now() + CANARY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    await sleep(CANARY_POLL_INTERVAL_MS);
    try {
      const res = await fetch(`${ctx.apiBase}/tasks/${taskId}`, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data = await res.json() as { task?: { status?: string }; status?: string };
      const status = data.task?.status ?? data.status;
      if (status === 'completed') {
        const completedAt = new Date().toISOString();
        const elapsedMs = Date.now() - new Date(dispatchedAt).getTime();
        await cleanupCanary(ctx.apiBase, taskId);
        return { taskId, dispatchedAt, completedAt, elapsedMs, passed: true, message: `Canary completed in ${elapsedMs}ms` };
      }
      if (status === 'failed' || status === 'cancelled') {
        await cleanupCanary(ctx.apiBase, taskId);
        return { taskId, dispatchedAt, completedAt: null, elapsedMs: null, passed: false, message: `Canary task ${status}` };
      }
    } catch {
      // transient poll error — keep trying
    }
  }

  // Timed out
  await cleanupCanary(ctx.apiBase, taskId);
  return {
    taskId,
    dispatchedAt,
    completedAt: null,
    elapsedMs: CANARY_TIMEOUT_MS,
    passed: false,
    message: `Canary timed out after ${CANARY_TIMEOUT_MS}ms — executor may not be running`,
  };
}

async function cleanupCanary(apiBase: string, taskId: string): Promise<void> {
  try {
    await fetch(`${apiBase}/tasks/${taskId}/cancel`, { method: 'POST', signal: AbortSignal.timeout(3000) });
  } catch { /* best-effort */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
