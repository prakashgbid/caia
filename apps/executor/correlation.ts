/**
 * correlation.ts — DASH-107
 *
 * The executor process emits five lifecycle events that need to be stamped
 * with the originating prompt's `root_prompt_id`, otherwise
 * `/prompts/:id/journey` undercounts events and `/prompts/:id/events?
 * correlation_id=...` returns an incomplete trace:
 *
 *   - apps/executor/dispatcher.ts        : worker.spawned
 *   - apps/executor/completion-hook.ts   : task.completed, task.failed,
 *                                          worker.completed, worker.failed
 *
 * The executor doesn't have direct DB access — it talks to the orchestrator
 * over HTTP. This helper fetches the task's `rootPromptId` field via
 * `GET /tasks/:id` and returns it so callers can pass `correlation_id` on
 * the next `POST /events`. The DB column carries a sentinel `'untraced'` for
 * tasks that didn't originate from a prompt (migration 0014); we propagate
 * that sentinel rather than inventing a new value, so `/prompts/:id/events`
 * for legitimate prompts isn't polluted by untraced workers.
 */

const API_BASE = process.env['CONDUCTOR_API'] ?? 'http://localhost:7776';

interface TaskCorrelationFields {
  rootPromptId?: string | null;
}

/**
 * Returns the task's `root_prompt_id` so executor-emitted events can be
 * stamped with `correlation_id`. Returns `null` if the task can't be
 * fetched (network/HTTP error) — callers should treat that as "no
 * correlation available" and emit without the field.
 */
export async function lookupCorrelationId(taskId: string): Promise<string | null> {
  try {
    const res = await fetch(`${API_BASE}/tasks/${taskId}`);
    if (!res.ok) return null;
    const task = await res.json() as TaskCorrelationFields;
    return task.rootPromptId ?? null;
  } catch {
    return null;
  }
}
