import { InMemoryStateStore } from './in-memory-store.js';
import { StateMachine } from './state-machine.js';
import type { ProjectState } from './states.js';
import type { StateMachineOptions } from './types.js';

/** Build a fresh in-memory StateMachine for tests. */
export function buildInMemoryStateMachine(opts: StateMachineOptions = {}): {
  sm: StateMachine;
  store: InMemoryStateStore;
} {
  const store = new InMemoryStateStore();
  const sm = new StateMachine(store, opts);
  return { sm, store };
}

/** Helper: walk a project through the canonical happy path. */
export const HAPPY_PATH: ReadonlyArray<[ProjectState, ProjectState]> = [
  ['onboarding', 'idea-captured'],
  ['idea-captured', 'interviewing'],
  ['interviewing', 'interview-complete'],
  // ADR-024 (2026-05-25): canonical path is now interview-complete →
  // information-architecture-in-progress → information-architecture-complete
  // → proposal-generated. Step 4 consumes IA artifacts instead of inventing
  // them inline.
  ['interview-complete', 'information-architecture-in-progress'],
  [
    'information-architecture-in-progress',
    'information-architecture-complete',
  ],
  ['information-architecture-complete', 'proposal-generated'],
  ['proposal-generated', 'awaiting-external-design'],
  ['awaiting-external-design', 'design-uploaded'],
  ['design-uploaded', 'ticket-tree-generated'],
  ['ticket-tree-generated', 'atlas-ready'],
  ['atlas-ready', 'ea-dispatching'],
  ['ea-dispatching', 'ea-complete'],
  ['ea-complete', 'tests-authored'],
  ['tests-authored', 'tests-reviewed'],
  ['tests-reviewed', 'scheduled'],
  ['scheduled', 'coding-in-progress'],
  ['coding-in-progress', 'code-complete'],
  ['code-complete', 'per-story-tested'],
  ['per-story-tested', 'e2e-tested'],
  ['e2e-tested', 'deploying'],
  ['deploying', 'deployed'],
  ['deployed', 'verified'],
  ['verified', 'done'],
];

// Re-export the solution-side test helpers so callers can `import { ... } from '@caia/state-machine/test-support'`.
export {
  buildInMemorySolutionMachine,
  SOLUTION_HAPPY_PATH,
  fakeAttestation,
} from './entities/solution-test-support.js';
