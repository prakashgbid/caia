/**
 * @caia/interviewer — explicit FSM with per-state guards.
 *
 * Implements spec §1.2 transitions exactly:
 *
 *   INIT          → PLANNING                                 (skeleton extracted)
 *   PLANNING      → ASKING                                   (questions picked)
 *   ASKING        → AWAITING_USER                            (questions sent)
 *   AWAITING_USER → INGESTING                                (user reply received)
 *   AWAITING_USER → PAUSED                                   (24h timeout)
 *   INGESTING     → EVALUATING                               (sections updated)
 *   EVALUATING    → PLANNING                                 (score < 82)
 *   EVALUATING    → SELF_CRITIQUE                            (score ≥ 82)
 *   SELF_CRITIQUE → PLANNING                                 (critic surfaces gaps)
 *   SELF_CRITIQUE → COMPLETE                                 (critic clean)
 *   COMPLETE      → HANDOFF                                  (handoff emitted)
 *   PAUSED        → PLANNING                                 (user resumes)
 *
 *   ANY non-terminal → FORCE_CLOSED                          (operator override)
 *
 *   HANDOFF and FORCE_CLOSED are terminal — no transitions out.
 *
 * The machine is a *pure* state-transition oracle. It does not perform
 * I/O, does not call LLMs, and does not write to Postgres. Side effects
 * are orchestrated by `Interviewer` which calls `machine.transition(...)`
 * and uses the returned `StateTransition` as a journal entry.
 */

import { InterviewerError } from './errors.js';
import {
  type InterviewState,
  isTerminal,
  type StateTransition,
} from './types.js';

const ALLOWED: Readonly<Record<InterviewState, readonly InterviewState[]>> = {
  INIT: ['PLANNING', 'FORCE_CLOSED'],
  PLANNING: ['ASKING', 'FORCE_CLOSED'],
  ASKING: ['AWAITING_USER', 'FORCE_CLOSED'],
  AWAITING_USER: ['INGESTING', 'PAUSED', 'FORCE_CLOSED'],
  INGESTING: ['EVALUATING', 'FORCE_CLOSED'],
  EVALUATING: ['PLANNING', 'SELF_CRITIQUE', 'FORCE_CLOSED'],
  SELF_CRITIQUE: ['PLANNING', 'COMPLETE', 'FORCE_CLOSED'],
  COMPLETE: ['HANDOFF'],
  HANDOFF: [],
  PAUSED: ['PLANNING', 'FORCE_CLOSED'],
  FORCE_CLOSED: [],
};

export interface StateMachineSnapshot {
  readonly state: InterviewState;
  readonly turnNumber: number;
  readonly history: readonly StateTransition[];
}

export interface TransitionInput {
  readonly to: InterviewState;
  readonly reason: string;
  readonly turnNumber?: number;
  readonly at?: Date;
}

export class StateMachine {
  private _state: InterviewState;
  private _turnNumber: number;
  private readonly _history: StateTransition[];

  public constructor(initial: InterviewState = 'INIT', turnNumber = 0) {
    this._state = initial;
    this._turnNumber = turnNumber;
    this._history = [];
  }

  public get state(): InterviewState {
    return this._state;
  }

  public get turnNumber(): number {
    return this._turnNumber;
  }

  public get history(): readonly StateTransition[] {
    return this._history;
  }

  public snapshot(): StateMachineSnapshot {
    return {
      state: this._state,
      turnNumber: this._turnNumber,
      history: [...this._history],
    };
  }

  public allowedNext(): readonly InterviewState[] {
    return ALLOWED[this._state];
  }

  public canTransition(to: InterviewState): boolean {
    return ALLOWED[this._state].includes(to);
  }

  public transition(input: TransitionInput): StateTransition {
    if (isTerminal(this._state)) {
      throw new InterviewerError(
        'terminal_state_locked',
        `cannot transition out of terminal state ${this._state}`,
        { state: this._state, attempted: input.to },
      );
    }
    if (!this.canTransition(input.to)) {
      throw new InterviewerError(
        'invalid_state_transition',
        `illegal transition ${this._state} → ${input.to}`,
        { from: this._state, to: input.to, allowed: ALLOWED[this._state] },
      );
    }
    const transition: StateTransition = {
      from: this._state,
      to: input.to,
      reason: input.reason,
      turnNumber: input.turnNumber ?? this._turnNumber,
      at: input.at ?? new Date(),
    };
    this._state = input.to;
    if (input.turnNumber !== undefined) {
      this._turnNumber = input.turnNumber;
    }
    this._history.push(transition);
    return transition;
  }

  public forceClose(reason: string, at?: Date): StateTransition | null {
    if (this._state === 'FORCE_CLOSED') return null;
    if (this._state === 'HANDOFF') {
      throw new InterviewerError(
        'force_close_after_terminal',
        'cannot force-close an interview that already reached HANDOFF',
        { state: this._state },
      );
    }
    return this.transition({
      to: 'FORCE_CLOSED',
      reason,
      ...(at !== undefined ? { at } : {}),
    });
  }

  public bumpTurn(to?: number): number {
    this._turnNumber = to ?? this._turnNumber + 1;
    return this._turnNumber;
  }

  public resume(reason = 'user_resumed'): StateTransition {
    if (this._state !== 'PAUSED') {
      throw new InterviewerError(
        'resume_invalid_state',
        `resume() only valid from PAUSED, current state ${this._state}`,
        { state: this._state },
      );
    }
    return this.transition({ to: 'PLANNING', reason });
  }
}

export function allowedTransitionsFrom(state: InterviewState): readonly InterviewState[] {
  return ALLOWED[state];
}

export function transitionGraph(): Readonly<Record<InterviewState, readonly InterviewState[]>> {
  return ALLOWED;
}
