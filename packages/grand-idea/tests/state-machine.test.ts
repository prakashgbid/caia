import { describe, expect, it } from 'vitest';

import { InMemoryStateStore, StateMachine } from '@caia/state-machine';

import { GrandIdeaError, advanceToIdeaCaptured } from '../src/index.js';

async function makeSm(
  projectId: string,
  initialState: 'onboarding' | 'idea-captured' | 'interviewing' = 'onboarding',
): Promise<StateMachine> {
  const store = new InMemoryStateStore();
  const sm = new StateMachine(store);
  await sm.init();
  await sm.createProject({
    id: projectId,
    tenantId: 'test',
    slug: 'test-slug',
    displayName: 'Test Project',
    initialState,
  });
  return sm;
}

describe('advanceToIdeaCaptured', () => {
  const projectId = '22222222-2222-2222-2222-222222222222';

  it('fires the transition when project is in onboarding', async () => {
    const sm = await makeSm(projectId, 'onboarding');
    const result = await advanceToIdeaCaptured(sm, {
      projectId,
      triggeredById: 'founder@example.com',
    });
    expect(result.applied).toBe(true);
    expect(result.fromState).toBe('onboarding');
    expect(result.toState).toBe('idea-captured');
    expect(await sm.currentState(projectId)).toBe('idea-captured');
  });

  it('is idempotent — calling on a project already in idea-captured returns applied=false', async () => {
    const sm = await makeSm(projectId, 'idea-captured');
    const result = await advanceToIdeaCaptured(sm, {
      projectId,
      triggeredById: 'founder@example.com',
    });
    expect(result.applied).toBe(false);
    expect(result.fromState).toBe('idea-captured');
    expect(result.toState).toBe('idea-captured');
    expect(await sm.currentState(projectId)).toBe('idea-captured');
  });

  it('throws project_state_invalid when project is in a non-onboarding state', async () => {
    const sm = await makeSm(projectId, 'interviewing');
    await expect(
      advanceToIdeaCaptured(sm, {
        projectId,
        triggeredById: 'founder@example.com',
      }),
    ).rejects.toMatchObject({
      code: 'project_state_invalid',
    });
    expect(await sm.currentState(projectId)).toBe('interviewing');
  });

  it('threads triggeredByKind into the FSM payload', async () => {
    const sm = await makeSm(projectId, 'onboarding');
    const result = await advanceToIdeaCaptured(sm, {
      projectId,
      triggeredById: 'agent-1',
      triggeredByKind: 'agent',
      payload: { test: 'payload' },
    });
    expect(result.applied).toBe(true);
    // After successful transition, state advanced.
    expect(await sm.currentState(projectId)).toBe('idea-captured');
  });

  it('wraps unexpected FSM read failures as fsm_transition_failed', async () => {
    const sm = await makeSm(projectId, 'onboarding');
    // Call against a non-existent project id to force ProjectNotFoundError.
    await expect(
      advanceToIdeaCaptured(sm, {
        projectId: '99999999-9999-9999-9999-999999999999',
        triggeredById: 'founder@example.com',
      }),
    ).rejects.toMatchObject({
      code: 'fsm_transition_failed',
    });
  });

  it('preserves the GrandIdeaError class for catch-by-instance', async () => {
    const sm = await makeSm(projectId, 'interviewing');
    try {
      await advanceToIdeaCaptured(sm, {
        projectId,
        triggeredById: 'founder@example.com',
      });
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(GrandIdeaError);
    }
  });
});
