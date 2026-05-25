/**
 * Internal runtime state machine for `deploy()`.
 *
 * Distinct from the canonical Solution lifecycle FSM (`@caia/state-machine`):
 *   - the canonical FSM tracks the SOLUTION (cross-process, durable)
 *   - this state machine tracks the IN-PROCESS deploy() call
 *
 * The mapping back to the canonical FSM happens once at the end of
 * `deploy()`:
 *   - `succeeded`     → `deployed`
 *   - `failed`        → `deployed-failed`
 *   - `rolled-back`   → `deployed-rolled-back` (only if we were already at `deployed`)
 *   - `rollback-failed` → `deployed-failed` (rollback couldn't compensate)
 *
 * The states + transitions below are exhaustive — the FSM is purely
 * declarative, used by `api.ts` to guard against accidental skips.
 */

import type { RuntimeState, RuntimeStateEvent } from './types.js';

export const RUNTIME_STATES = [
  'idle',
  'loading-spec',
  'preconditions-checking',
  'acquiring-capability',
  'deploying',
  'verifying',
  'succeeded',
  'failed',
  'rolling-back',
  'rolled-back',
  'rollback-failed',
] as const satisfies readonly RuntimeState[];

/** Terminal states (no outbound transitions). */
export const RUNTIME_TERMINAL_STATES: readonly RuntimeState[] = [
  'rolled-back',
  'rollback-failed',
] as const;

/** Static transition table — every legal edge enumerated. */
export const RUNTIME_VALID_TRANSITIONS: Readonly<Record<RuntimeState, readonly RuntimeState[]>> = {
  'idle': ['loading-spec', 'failed'],
  'loading-spec': ['preconditions-checking', 'failed'],
  'preconditions-checking': ['acquiring-capability', 'failed'],
  'acquiring-capability': ['deploying', 'failed'],
  'deploying': ['verifying', 'failed'],
  'verifying': ['succeeded', 'failed'],
  'succeeded': ['rolling-back'], // post-deploy regression can still trigger rollback
  'failed': ['rolling-back'],
  'rolling-back': ['rolled-back', 'rollback-failed'],
  // Terminal:
  'rolled-back': [],
  'rollback-failed': [],
};

export interface RuntimeStateMachineOptions {
  ticketId: string;
  clock?: () => Date;
  onTransition?: (event: RuntimeStateEvent) => void;
}

export class InvalidRuntimeTransitionError extends Error {
  constructor(public readonly from: RuntimeState, public readonly to: RuntimeState) {
    super(`invalid runtime transition ${from} -> ${to}`);
    this.name = 'InvalidRuntimeTransitionError';
  }
}

export function canRuntimeTransition(from: RuntimeState, to: RuntimeState): boolean {
  if (from === to) return false;
  return RUNTIME_VALID_TRANSITIONS[from].includes(to);
}

export function isRuntimeTerminal(state: RuntimeState): boolean {
  return RUNTIME_TERMINAL_STATES.includes(state);
}

/** A small, dependency-free FSM driver used by `api.ts`. The `trace`
 * member is the per-call audit trail exposed on `DeploymentResult`. */
export class RuntimeStateMachine {
  private _state: RuntimeState = 'idle';
  public readonly trace: RuntimeStateEvent[] = [];
  private readonly clock: () => Date;

  constructor(private readonly opts: RuntimeStateMachineOptions) {
    this.clock = opts.clock ?? ((): Date => new Date());
  }

  get state(): RuntimeState {
    return this._state;
  }

  /** Transition or throw. Records the event in `trace` and fires the
   * `onTransition` callback (if any). Self-transitions throw. */
  transition(to: RuntimeState, reason?: string): void {
    if (!canRuntimeTransition(this._state, to)) {
      throw new InvalidRuntimeTransitionError(this._state, to);
    }
    const event: RuntimeStateEvent = {
      ticketId: this.opts.ticketId,
      fromState: this._state,
      toState: to,
      atIso: this.clock().toISOString(),
      ...(reason !== undefined ? { reason } : {}),
    };
    this._state = to;
    this.trace.push(event);
    this.opts.onTransition?.(event);
  }

  /** Snapshot of all transitions. */
  snapshot(): { state: RuntimeState; trace: RuntimeStateEvent[] } {
    return { state: this._state, trace: [...this.trace] };
  }
}
