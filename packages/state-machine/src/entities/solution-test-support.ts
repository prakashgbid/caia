import { InMemorySolutionStore } from './in-memory-solution-store.js';
import { SolutionLifecycleMachine } from './solution.js';
import {
  SOLUTION_FORWARD_STATES,
  type SolutionState,
} from './solution-states.js';
import type { SolutionMachineOptions } from './solution-types.js';

/** Build a fresh in-memory SolutionLifecycleMachine for tests. */
export function buildInMemorySolutionMachine(opts: SolutionMachineOptions = {}): {
  machine: SolutionLifecycleMachine;
  store: InMemorySolutionStore;
} {
  const store = new InMemorySolutionStore();
  const machine = new SolutionLifecycleMachine(store, opts);
  return { machine, store };
}

/** Canonical happy-path walk through every forward state.
 * `approved` is the initial state, so the walk starts at the first
 * transition. */
export const SOLUTION_HAPPY_PATH: ReadonlyArray<[SolutionState, SolutionState]> = (() => {
  const out: [SolutionState, SolutionState][] = [];
  for (let i = 0; i < SOLUTION_FORWARD_STATES.length - 1; i++) {
    const from = SOLUTION_FORWARD_STATES[i];
    const to = SOLUTION_FORWARD_STATES[i + 1];
    if (from !== undefined && to !== undefined) {
      out.push([from, to]);
    }
  }
  return out;
})();

/** Convenience: a fake steward-id -> the canonical green attestation shape. */
export function fakeAttestation(steward: string, idSuffix: string) {
  return {
    steward,
    id: `${steward.slice(0, 2)}-${idSuffix}`,
    status: 'green' as const,
    at: new Date().toISOString(),
  };
}
