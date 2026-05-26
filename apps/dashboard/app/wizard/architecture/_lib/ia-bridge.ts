/**
 * Server-side bridge to `@caia/info-architect` — drives `runInformationArchitecture`.
 *
 * Subscription-only contract — all LLM dispatch goes through
 * `@chiefaia/claude-spawner` with `rejectIfApiKeyPresent: true` (the
 * exact pattern affected by the June-15-2026 Anthropic Agent SDK
 * metering change; the spawner-migration is a separate future task).
 *
 * For now we use the in-memory persistence + a no-op FSM adapter; the
 * wizard-shell sibling task is wiring the real Postgres + project-FSM
 * adapters into the route handler. We surface a small, narrow API so
 * tests can stub the agent without spawning `claude`.
 */
import {
  IaMemoryPersistence,
  InfoArchitectAgent,
  runInformationArchitecture,
  type IaInput,
  type IaOutput,
  type IaStateMachineAdapter,
  type SpawnClaudeFn,
} from '@caia/info-architect';
import type { ProjectState } from '@caia/state-machine';
import { spawnClaude as realSpawnClaude } from '@chiefaia/claude-spawner';

export interface RunIaInput {
  readonly projectId: string;
  readonly tenantSlug: string;
  readonly iaInput?: IaInput;
}

export interface RunIaResult {
  readonly projectId: string;
  readonly iaRevisionId: string;
  readonly output: IaOutput;
  readonly fsmTransitions: readonly unknown[];
  readonly writtenAtIso: string;
}

export interface RunIaDeps {
  readonly agent?: { design: (input: IaInput) => Promise<IaOutput> };
  readonly persistence?: IaMemoryPersistence;
  readonly stateMachine?: IaStateMachineAdapter;
}

/**
 * Build the default subscription-only spawn fn — mirrors the contract
 * `@caia/info-architect`'s `SpawnClaudeFn` expects.
 */
export const defaultSpawnClaude: SpawnClaudeFn = async (input) => {
  const res = await realSpawnClaude({
    prompt: input.prompt,
    options: { ...(input.options ?? {}) },
    constraints: { rejectIfApiKeyPresent: true },
  });
  return res;
};

/**
 * A minimal in-memory FSM adapter so the page can drive the canonical
 * transitions even when the real project-FSM persistence isn't wired
 * yet. The shell task replaces this with the real adapter.
 */
export function makeMemoryFsmAdapter(
  initial: ProjectState = 'interview-complete',
): IaStateMachineAdapter {
  let state: ProjectState = initial;
  const history: Array<{ to: ProjectState; reason?: string }> = [];
  return {
    async currentState() {
      return state;
    },
    async transition(_projectId, to, ctx) {
      const transition = {
        projectId: _projectId,
        from: state,
        to,
        reason: ctx?.reason ?? 'unspecified',
        triggeredById: ctx?.triggeredById ?? '@caia/info-architect',
        at: new Date().toISOString(),
      };
      history.push({ to, reason: ctx?.reason });
      state = to;
      return transition;
    },
  };
}

export async function runIa(
  input: RunIaInput,
  deps: RunIaDeps = {},
): Promise<RunIaResult> {
  const persistence = deps.persistence ?? new IaMemoryPersistence();
  if (input.iaInput) {
    await persistence.writeInput(input.projectId, input.iaInput);
  }

  const agent =
    deps.agent ??
    new InfoArchitectAgent({
      spawnClaude: defaultSpawnClaude,
    });

  const stateMachine = deps.stateMachine ?? makeMemoryFsmAdapter('interview-complete');

  const result = await runInformationArchitecture(input.projectId, {
    agent,
    persistence,
    stateMachine,
    triggeredById: 'wizard-architecture-step',
  });
  return result;
}
