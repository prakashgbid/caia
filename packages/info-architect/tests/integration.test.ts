import { describe, expect, it } from 'vitest';

import {
  InfoArchitectAgent,
  IaMemoryPersistence,
  runInformationArchitecture,
  buildIaSystemPrompt,
  CREDENTIAL_ARCHETYPES,
  IA_PILLARS,
  isIaInput,
  isIaOutput,
} from '../src/index.js';
import { synthesiseSkeletonOutput } from '../src/agent.js';
import { buildIaInput, StubFsm } from './fixtures.js';

const CLOCK = (): Date => new Date('2026-05-25T12:00:00.000Z');

describe('@caia/info-architect — end-to-end', () => {
  it('runs the full FSM chain with in-memory backends', async () => {
    const input = buildIaInput();
    const persistence = new IaMemoryPersistence({
      clock: CLOCK,
      inputs: [[input.projectId, input]],
    });
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () =>
        JSON.stringify(synthesiseSkeletonOutput(input, CLOCK)),
      clock: CLOCK,
    });

    const result = await runInformationArchitecture(input.projectId, {
      agent,
      persistence,
      stateMachine,
      clock: CLOCK,
    });

    expect(result.fsmTransitions.length).toBe(2);
    expect(result.output.componentsLibrary.components.length).toBeGreaterThanOrEqual(5);

    const archetypeCount = result.output.componentsLibrary.components
      .filter((c) => c.credentialArchetype !== undefined)
      .length;
    expect(archetypeCount).toBe(5);

    const persisted = await persistence.readLatestArtifacts(input.projectId);
    expect(persisted).not.toBeNull();
  });

  it('re-running the orchestrator on a completed project rejects with project_state_invalid', async () => {
    const input = buildIaInput();
    const persistence = new IaMemoryPersistence({
      clock: CLOCK,
      inputs: [[input.projectId, input]],
    });
    const stateMachine = new StubFsm({ initialState: 'interview-complete' });
    const agent = new InfoArchitectAgent({
      scriptedLlm: async () =>
        JSON.stringify(synthesiseSkeletonOutput(input, CLOCK)),
      clock: CLOCK,
    });

    await runInformationArchitecture(input.projectId, {
      agent,
      persistence,
      stateMachine,
      clock: CLOCK,
    });

    await expect(
      runInformationArchitecture(input.projectId, {
        agent,
        persistence,
        stateMachine,
        clock: CLOCK,
      }),
    ).rejects.toMatchObject({ code: 'project_state_invalid' });
  });

  it('public barrel exports the expected surface', () => {
    expect(typeof runInformationArchitecture).toBe('function');
    expect(typeof InfoArchitectAgent).toBe('function');
    expect(typeof IaMemoryPersistence).toBe('function');
    expect(typeof buildIaSystemPrompt).toBe('function');
    expect(Array.isArray(IA_PILLARS)).toBe(true);
    expect(Array.isArray(CREDENTIAL_ARCHETYPES)).toBe(true);
    expect(typeof isIaInput).toBe('function');
    expect(typeof isIaOutput).toBe('function');
  });
});
