/**
 * Circuit breaker — after threshold failures, pauses the task and files a blocker.
 */

import { metrics } from './metrics';

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function checkAndBreak(
  taskId: string,
  taskTitle: string,
  attemptCount: number,
  threshold: number,
  reason: string,
): Promise<boolean> {
  if (attemptCount < threshold) return false;
  metrics.circuitBreakerTrips.inc();
  try {
    await fetch(`${API_BASE}/executor/tasks/${taskId}/unpause`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pause: true, reason: `Circuit breaker: ${attemptCount} failed attempts` }),
    });
    await fetch(`${API_BASE}/blockers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        title: `Task "${taskTitle}" (${taskId}) circuit-breaker tripped after ${attemptCount} failures`,
        severity: 'high',
        kind: 'circuit-breaker',
        taskId,
        description: reason,
        resolutionSteps: JSON.stringify(['Investigate failure logs', `Run: conductor exec attempt --task ${taskId} --reset-breaker`]),
      }),
    });
  } catch { /* non-fatal */ }
  return true;
}
