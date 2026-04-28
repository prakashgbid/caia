/**
 * Shared event publisher for the executor.
 *
 * Emits structured events to the orchestrator's /events endpoint.
 * Never throws — all errors are swallowed so event publishing can never
 * crash the executor process.
 */

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export async function publishEvent(
  type: string,
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type, actor: 'executor', payload, timestamp: Date.now() }),
    });
  } catch (err) {
    // Never let event publishing crash the executor
    if (process.env['EXECUTOR_DEBUG']) {
      process.stderr.write(
        `[executor:publish-event] Failed to publish "${type}": ${err instanceof Error ? err.message : String(err)}\n`,
      );
    }
  }
}
