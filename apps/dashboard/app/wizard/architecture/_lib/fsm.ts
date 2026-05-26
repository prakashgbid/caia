/**
 * Project-level FSM dispatch helper for the architecture step.
 *
 * Duplicates the interview step's helper because each route directory
 * is self-contained per ownership rules. When the wizard-shell sibling
 * task lands, both copies converge on `@/lib/wizard/fsm.ts`.
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
    return { ok: false, state: null, status: 0 };
  }
}

export const IA_FROM: ProjectState = 'information-architecture-in-progress';
export const IA_TO: ProjectState = 'information-architecture-complete';
