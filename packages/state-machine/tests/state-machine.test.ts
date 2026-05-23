import { beforeEach, describe, expect, it } from 'vitest';

import {
  InvalidTransitionError,
  ProjectNotFoundError,
  StaleProjectVersionError,
} from '../src/errors.js';
import {
  buildInMemoryStateMachine,
  HAPPY_PATH,
} from '../src/test-support.js';

describe('StateMachine', () => {
  let sm: ReturnType<typeof buildInMemoryStateMachine>['sm'];
  let store: ReturnType<typeof buildInMemoryStateMachine>['store'];

  beforeEach(async () => {
    ({ sm, store } = buildInMemoryStateMachine({ idempotencyWindowMs: 0 }));
    await sm.init();
  });

  const newProject = (slug = 'p') =>
    sm.createProject({ tenantId: 't', slug, displayName: slug.toUpperCase() });

  it('createProject + currentState round-trip', async () => {
    const p = await newProject();
    expect(await sm.currentState(p.id)).toBe('onboarding');
  });

  it('currentState throws for missing project', async () => {
    await expect(sm.currentState('11111111-1111-1111-1111-111111111111'))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('transitions through the entire happy path', async () => {
    const p = await newProject();
    for (const [, to] of HAPPY_PATH) {
      await sm.transition(p.id, to, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { to },
      });
    }
    expect(await sm.currentState(p.id)).toBe('done');
  });

  it('rejects an illegal transition with InvalidTransitionError', async () => {
    const p = await newProject();
    await expect(
      sm.transition(p.id, 'done', {
        reason: 'jump',
        triggeredBy: { kind: 'system', id: 'test' },
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('rejects a transition out of a terminal state', async () => {
    const p = await newProject();
    for (const [, to] of HAPPY_PATH) {
      await sm.transition(p.id, to, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { to },
      });
    }
    await expect(
      sm.transition(p.id, 'archived', {
        reason: 'late',
        triggeredBy: { kind: 'system', id: 'test' },
      }),
    ).rejects.toBeInstanceOf(InvalidTransitionError);
  });

  it('transition returns applied=true on first call, false on idempotent replay', async () => {
    const p = await newProject();
    const a = await sm.transition(p.id, 'idea-captured', {
      reason: 'init',
      triggeredBy: { kind: 'system', id: 'test' },
      payload: { ping: 1 },
    });
    expect(a.applied).toBe(true);

    // Force the project back into onboarding by direct store mutation so
    // we can replay the same transition with the same payload-hash.
    const rec = (await store.getProject(p.id))!;
    // simulate replay: try the same transition again on the same state
    // (now we're at idea-captured) — payload-hash match returns applied=false
    const b = await sm.transition(p.id, 'idea-captured', {
      reason: 'replay',
      triggeredBy: { kind: 'system', id: 'test' },
      payload: { ping: 1 },
    });
    expect(b.applied).toBe(false);
    expect(b.historyId).toBe(a.historyId);
    expect(rec.status).toBe('idea-captured');
  });

  it('positional transition form works', async () => {
    const p = await newProject();
    const r = await sm.transition(p.id, 'idea-captured', 'positional', 'tester');
    expect(r.applied).toBe(true);
  });

  it('positional form requires triggeredBy', async () => {
    const p = await newProject();
    await expect(
      (sm.transition as unknown as (
        a: string,
        b: string,
        c: string,
      ) => Promise<unknown>)(p.id, 'idea-captured', 'positional'),
    ).rejects.toBeInstanceOf(TypeError);
  });

  it('honors expectedVersion to detect a stale snapshot', async () => {
    const p = await newProject();
    await expect(
      sm.transition(p.id, 'idea-captured', {
        reason: 'r',
        triggeredBy: { kind: 'system', id: 'test' },
        expectedVersion: 99,
      }),
    ).rejects.toBeInstanceOf(StaleProjectVersionError);
  });

  it('availableTransitions + validNextStates are spec-aligned', async () => {
    const states = sm.availableTransitions('onboarding');
    expect(states).toContain('idea-captured');
    expect(sm.validNextStates('onboarding')).toEqual(states);
    expect(sm.canTransition('onboarding', 'idea-captured')).toBe(true);
  });

  it('pause / resume toggle the project paused flag', async () => {
    const p = await newProject();
    await sm.pause(p.id, 'op-1');
    const a = await sm.getProject(p.id);
    expect(a!.paused).toBe(true);
    await sm.resume(p.id);
    const b = await sm.getProject(p.id);
    expect(b!.paused).toBe(false);
  });

  it('pause throws for unknown project', async () => {
    await expect(sm.pause('00000000-0000-0000-0000-000000000099', 'op'))
      .rejects.toBeInstanceOf(ProjectNotFoundError);
  });

  it('abandon transitions the project to archived from any state', async () => {
    const p = await newProject();
    const r = await sm.abandon(p.id, 'operator-jane');
    expect(r.applied).toBe(true);
    expect(await sm.currentState(p.id)).toBe('archived');
  });

  it('replayHistory returns the audit trail in id order', async () => {
    const p = await newProject();
    await sm.transition(p.id, 'idea-captured', {
      reason: 'r1',
      triggeredBy: { kind: 'system', id: 'test' },
      payload: { i: 1 },
    });
    await sm.transition(p.id, 'interviewing', {
      reason: 'r2',
      triggeredBy: { kind: 'system', id: 'test' },
      payload: { i: 2 },
    });
    const rows = await sm.replayHistory(p.id);
    expect(rows.map((r) => r.toState)).toEqual([
      'idea-captured',
      'interviewing',
    ]);
  });

  it('replayHistory filters by toState', async () => {
    const p = await newProject();
    await sm.transition(p.id, 'idea-captured', {
      reason: 'r1',
      triggeredBy: { kind: 'system', id: 'test' },
      payload: { i: 1 },
    });
    await sm.transition(p.id, 'interviewing', {
      reason: 'r2',
      triggeredBy: { kind: 'system', id: 'test' },
      payload: { i: 2 },
    });
    const rows = await sm.replayHistory(p.id, { toState: 'idea-captured' });
    expect(rows.length).toBe(1);
    expect(rows[0]!.toState).toBe('idea-captured');
  });

  it('TransitionResult carries retries (0 on first try)', async () => {
    const p = await newProject();
    const r = await sm.transition(p.id, 'idea-captured', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 'test' },
    });
    expect(r.retries).toBe(0);
  });
});
