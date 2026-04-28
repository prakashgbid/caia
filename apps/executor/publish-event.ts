/**
 * Shared event publisher for the executor.
 *
 * Emits structured events to the orchestrator's /events endpoint.
 * Never throws — all errors are swallowed so event publishing can never
 * crash the executor process.
 *
 * DASH-107: events stamped via this helper now propagate `correlation_id`
 * (the originating prompt's id, threaded through the executor boundary)
 * plus `entity_type` / `entity_id` so the orchestrator can attribute
 * downstream events to a task. /prompts/:id/journey and
 * /prompts/:id/events?correlation_id=... need this to build a complete
 * trace across the executor → worker hop.
 */

const ORCHESTRATOR_URL = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

export interface PublishEventOpts {
  /** Originating prompt id; usually `task.rootPromptId`. May be `'untraced'`. */
  correlationId?: string | null;
  /** Entity type for attribution, e.g. `'task'`. */
  entityType?: string;
  /** Entity id for attribution, e.g. the task id. */
  entityId?: string;
}

export async function publishEvent(
  type: string,
  payload: Record<string, unknown>,
  opts: PublishEventOpts = {},
): Promise<void> {
  try {
    await fetch(`${ORCHESTRATOR_URL}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        actor: 'executor',
        payload,
        timestamp: Date.now(),
        correlation_id: opts.correlationId ?? undefined,
        entity_type: opts.entityType,
        entity_id: opts.entityId,
      }),
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
