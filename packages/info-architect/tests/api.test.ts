import { describe, expect, it } from 'vitest';

import {
  InfoArchitectAgent,
  synthesiseSkeletonOutput,
} from '../src/agent.js';
import { runInformationArchitecture } from '../src/api.js';
import { InfoArchitectError } from '../src/errors.js';
import { buildIaInput, buildMemoryPersistence, StubFsm } from './fixtures.js';

const CLOCK = (): Date => new Date('2026-05-25T12:00:00.000Z');

function buildAgent() {
  return new InfoArchitectAgent({
    scriptedLlm: async () =>
      JSON.stringify(synthesiseSkeletonOutput(buildIaInput(), CLOCK)),
    clock: CLOCK,
  });
}

describe('runInformationArchitecture — FSM chain', () => {
  it('drives interview-complete → IA-in-progress → IA-complete on the happy path', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    const agent = buildAgent();
    const result = await runInformationArchitecture(input.projectId, {
      agent,
      persistence,
      stateMachine,
      clock: CLOCK,
    });
    expect(result.fsmTransitions).toEqual([
      { from: 'interview-complete', to: 'information-architecture-in-progress' },
      {
        from: 'information-architecture-in-progress',
        to: 'information-architecture-complete',
      },
    ]);
    expect(stateMachine.state).toBe('information-architecture-complete');
  });

  it('returns the iaRevisionId from the persistence write', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    const result = await runInformationArchitecture(input.projectId, {
      agent: buildAgent(),
      persistence,
      stateMachine,
      clock: CLOCK,
    });
    expect(result.iaRevisionId).toBe(result.output.pagesCatalogue.revisionId);
  });

  it('persists all three artifacts on the happy path', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    await runInformationArchitecture(input.projectId, {
      agent: buildAgent(),
      persistence,
      stateMachine,
      clock: CLOCK,
    });
    const got = await persistence.readLatestArtifacts(input.projectId);
    expect(got).not.toBeNull();
    expect(got!.componentsLibrary.components.length).toBeGreaterThan(0);
  });

  it('rejects a project not in interview-complete', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({ initialState: 'idea-captured' });
    await expect(
      runInformationArchitecture(input.projectId, {
        agent: buildAgent(),
        persistence,
        stateMachine,
        clock: CLOCK,
      }),
    ).rejects.toMatchObject({ code: 'project_state_invalid' });
  });

  it('rejects when no IA input is persisted', async () => {
    const persistence = (await import('../src/persistence.js')).IaMemoryPersistence;
    const empty = new persistence({ clock: CLOCK });
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    await expect(
      runInformationArchitecture('11111111-1111-1111-1111-111111111111', {
        agent: buildAgent(),
        persistence: empty,
        stateMachine,
        clock: CLOCK,
      }),
    ).rejects.toMatchObject({ code: 'persistence_failed' });
  });

  it('routes to information-architecture-failed when the agent throws', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    const brokenAgent: ConstructorParameters<typeof InfoArchitectAgent>[0] = {
      scriptedLlm: async () => {
        throw new InfoArchitectError('llm_call_failed', 'forced failure');
      },
      clock: CLOCK,
      fallbackToSkeleton: false,
    };
    const agent = new InfoArchitectAgent(brokenAgent);
    await expect(
      runInformationArchitecture(input.projectId, {
        agent,
        persistence,
        stateMachine,
        clock: CLOCK,
      }),
    ).rejects.toMatchObject({ code: 'llm_call_failed' });
    expect(stateMachine.state).toBe('information-architecture-failed');
  });

  it('uses the supplied triggeredById on the FSM payload', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    await runInformationArchitecture(input.projectId, {
      agent: buildAgent(),
      persistence,
      stateMachine,
      clock: CLOCK,
      triggeredById: 'operator@caia.dev',
    });
    expect(stateMachine.transitions.length).toBe(2);
  });

  it('throws fsm_transition_failed when the FSM transition explodes', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({
      initialState: 'interview-complete',
      throwOnTransition: true,
    });
    await expect(
      runInformationArchitecture(input.projectId, {
        agent: buildAgent(),
        persistence,
        stateMachine,
        clock: CLOCK,
      }),
    ).rejects.toMatchObject({ code: 'fsm_transition_failed' });
  });

  it('throws fsm_transition_failed when currentState() blows up', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({
      initialState: 'interview-complete',
      throwOnRead: true,
    });
    await expect(
      runInformationArchitecture(input.projectId, {
        agent: buildAgent(),
        persistence,
        stateMachine,
        clock: CLOCK,
      }),
    ).rejects.toMatchObject({ code: 'fsm_transition_failed' });
  });

  it('records the writtenAtIso from the persistence write', async () => {
    const { persistence, input } = buildMemoryPersistence();
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    const result = await runInformationArchitecture(input.projectId, {
      agent: buildAgent(),
      persistence,
      stateMachine,
      clock: CLOCK,
    });
    expect(result.writtenAtIso).toBe('2026-05-25T12:00:00.000Z');
  });
});
