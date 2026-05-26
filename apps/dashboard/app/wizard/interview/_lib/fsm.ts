/**
 * Tiny wrapper around the project-level FSM dispatch endpoint.
 *
 * The actual FSM API is owned by the wizard-shell sibling task; this
 * helper degrades gracefully when the endpoint is missing so step 3
 * can ship independently. Tests stub `fetch` directly.
 *
 * Canonical state names (from `@caia/state-machine` `states.ts`):
 *   `interviewing` → `interview-complete`
 * The task brief uses `interview-in-progress` as conversational
 * shorthand for `interviewing`; we honour the canonical name.
 */

import type { ProjectState } from '@caia/state-machine';

export interface FsmDispatchInput {
  readonly projectId: string;
  readonly from: ProjectState;
  readonly to: ProjectState;
  readonly reason?: string;
  readonly payload?: Record<string, unknown>;
}

export interface FsmDispatchResult {
  readonly ok: boolean;
  readonly state: ProjectState | null;
  readonly status: number;
}

export async function dispatchFsmTransition(
  input: FsmDispatchInput,
  fetchImpl: typeof fetch = fetch,
): Promise<FsmDispatchResult> {
  try {
    const res = await fetchImpl('/api/wizard/fsm/transition', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    if (!res.ok) {
      return { ok: false, state: null, status: res.status };
    }
    const data = (await res.json().catch(() => ({}))) as { state?: ProjectState };
    return { ok: true, state: data.state ?? input.to, status: res.status };
  } catch {
    // Graceful degradation when the FSM endpoint isn't wired up yet.
    return { ok: false, state: null, status: 0 };
  }
}

export const INTERVIEW_FROM: ProjectState = 'interviewing';
export const INTERVIEW_TO: ProjectState = 'interview-complete';
export const IA_FROM: ProjectState = 'information-architecture-in-progress';
export const IA_TO: ProjectState = 'information-architecture-complete';
