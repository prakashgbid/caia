/**
 * Circuit breaker — after threshold failures (or any auth-class failure),
 * pauses the task and files a blocker.
 *
 * Permanent fix EXEC-001 (2026-04-30): the prior implementation called
 *   DELETE /executor/tasks/:id/unpause
 * with a `{pause:true}` body, which silently 404'd. That made the breaker a
 * no-op — failing tasks accumulated 3000+ retry attempts (audit
 * `outstanding-tasks-audit-2026-04-30.md`). Two changes here:
 *
 * 1. Use the correct contract endpoint: POST /executor/tasks/:id/pause
 *    (per execution-engine-lock-contract.md). Surfaces non-2xx as an
 *    error event so silent regressions can't return.
 *
 * 2. Auth-class failures (HTTP 401 / "authentication_error" / invalid
 *    credentials) trip the breaker IMMEDIATELY, regardless of attempt
 *    count, because retrying with bad credentials only burns money +
 *    rate-limit budget. A single attempt is enough signal.
 */
import { publishEvent } from './publish-event';

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

/**
 * Detect auth/credential failures that should hard-trip the breaker on the
 * very first attempt. Matches both Anthropic API ("authentication_error",
 * "Invalid authentication credentials") and HTTP 401 surface strings.
 *
 * @param reason — failure_reason string captured from the worker process.
 */
export function isAuthFailure(reason: string): boolean {
  if (!reason) return false;
  const r = reason.toLowerCase();
  return (
    r.includes('authentication_error') ||
    r.includes('invalid authentication') ||
    r.includes('api error: 401') ||
    r.includes('http 401') ||
    r.includes('unauthorized') ||
    r.includes('claude_code_oauth_token')
  );
}

/**
 * Decide whether the breaker should trip and (on trip) actually pause the
 * task and file a blocker.
 *
 * Returns `true` iff the breaker tripped. On trip the task is guaranteed to
 * be paused on the orchestrator (or an `executor.breaker.pause_failed` event
 * is emitted so the monitoring layer surfaces a regression).
 */
export async function checkAndBreak(
  taskId: string,
  taskTitle: string,
  attemptCount: number,
  threshold: number,
  reason: string,
): Promise<boolean> {
  const authTrip = isAuthFailure(reason);
  if (!authTrip && attemptCount < threshold) return false;

  const tripReason = authTrip
    ? `auth-error fast-trip after attempt ${attemptCount}: ${reason.slice(0, 200)}`
    : `Circuit breaker: ${attemptCount} failed attempts`;

  const severity: 'critical' | 'high' = authTrip ? 'critical' : 'high';
  const kind: string = authTrip ? 'auth-error' : 'circuit-breaker';

  // 1. Pause the task on the orchestrator. Use the contract endpoint
  //    (POST /executor/tasks/:id/pause). Failure here is a regression — the
  //    breaker MUST be able to pause, otherwise the daemon will respawn.
  let paused = false;
  try {
    const res = await fetch(`${API_BASE}/executor/tasks/${taskId}/pause`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: tripReason }),
    });
    paused = res.ok;
    if (!paused) {
      // Contract violation: surface loudly so the on-call sees it.
      try {
        await publishEvent('executor.breaker.pause_failed', {
          taskId,
          httpStatus: res.status,
          reason: tripReason,
          attemptCount,
        });
      } catch { /* publish best-effort */ }
    }
  } catch (err) {
    try {
      await publishEvent('executor.breaker.pause_failed', {
        taskId,
        httpStatus: 0,
        reason: tripReason,
        error: err instanceof Error ? err.message : String(err),
        attemptCount,
      });
    } catch { /* publish best-effort */ }
  }

  // 2. File a human-review blocker.
  try {
    await fetch(`${API_BASE}/blockers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: authTrip
          ? `Task "${taskTitle}" (${taskId}) auth-error fast-trip — credentials invalid`
          : `Task "${taskTitle}" (${taskId}) circuit-breaker tripped after ${attemptCount} failures`,
        severity,
        kind,
        taskId,
        description: reason,
        resolutionSteps: JSON.stringify(
          authTrip
            ? [
                'Check CLAUDE_CODE_OAUTH_TOKEN / ANTHROPIC_API_KEY in launchd plist + .env',
                'Run: claude /login   (or rotate API key)',
                `Run: conductor exec attempt --task ${taskId} --reset-breaker`,
              ]
            : [
                'Investigate failure logs',
                `Run: conductor exec attempt --task ${taskId} --reset-breaker`,
              ],
        ),
      }),
    });
  } catch { /* non-fatal */ }

  // 3. Structured trip event (was missing in the prior implementation).
  try {
    await publishEvent('executor.breaker.tripped', {
      taskId,
      attemptCount,
      reason: tripReason,
      kind,
      severity,
      paused,
    });
  } catch { /* non-fatal */ }

  return true;
}
