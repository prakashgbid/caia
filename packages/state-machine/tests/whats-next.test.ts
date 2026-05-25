import { beforeEach, describe, expect, it } from 'vitest';

import {
  buildInMemoryStateMachine,
  HAPPY_PATH,
} from '../src/test-support.js';
import { resumePoint, whatsNext } from '../src/whats-next.js';

describe('whatsNext', () => {
  let sm: ReturnType<typeof buildInMemoryStateMachine>['sm'];

  beforeEach(async () => {
    ({ sm } = buildInMemoryStateMachine({ idempotencyWindowMs: 0 }));
    await sm.init();
  });

  const newProject = (slug = 'p') =>
    sm.createProject({ tenantId: 't', slug, displayName: slug });

  it('returns the onboarding agent for a fresh project', async () => {
    const p = await newProject();
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(true);
    expect(r.agent?.type).toBe('@caia/onboarding');
    expect(r.agent?.onSuccessTransitionTo).toBe('idea-captured');
  });

  it('reports paused when the project is paused', async () => {
    const p = await newProject();
    await sm.pause(p.id, 'op');
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(false);
    expect(r.waitingOn).toBe('project-paused');
  });

  it('reports project-done at terminal happy state', async () => {
    const p = await newProject();
    for (const [, to] of HAPPY_PATH) {
      await sm.transition(p.id, to, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { to },
      });
    }
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(false);
    expect(r.waitingOn).toBe('project-done');
  });

  it('reports waiting-for-external at awaiting-external-design', async () => {
    const p = await newProject();
    for (const target of [
      'idea-captured',
      'interviewing',
      'interview-complete',
      'information-architecture-in-progress',
      'information-architecture-complete',
      'proposal-generated',
      'awaiting-external-design',
    ] as const) {
      await sm.transition(p.id, target, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { target },
      });
    }
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(false);
    expect(r.waitingOn).toBe('waiting-for-external');
  });

  it('reports waiting-for-operator at atlas-ready', async () => {
    const p = await newProject();
    for (const target of [
      'idea-captured',
      'interviewing',
      'interview-complete',
      'information-architecture-in-progress',
      'information-architecture-complete',
      'proposal-generated',
      'awaiting-external-design',
      'design-uploaded',
      'ticket-tree-generated',
      'atlas-ready',
    ] as const) {
      await sm.transition(p.id, target, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { target },
      });
    }
    const r = await whatsNext(sm, p.id);
    expect(r.waitingOn).toBe('waiting-for-operator');
  });

  it('reports waiting-for-failure-recovery at a *-failed state', async () => {
    const p = await newProject();
    await sm.transition(p.id, 'onboarding-failed', {
      reason: 'broke',
      triggeredBy: { kind: 'system', id: 'test' },
    });
    const r = await whatsNext(sm, p.id);
    expect(r.waitingOn).toBe('waiting-for-failure-recovery');
  });

  it('exposes parameters with project + tenant ids', async () => {
    const p = await newProject();
    const r = await whatsNext(sm, p.id);
    expect(r.parameters.project_id).toBe(p.id);
    expect(r.parameters.tenant_id).toBe('t');
  });

  it('is idempotent on the same state', async () => {
    const p = await newProject();
    const a = await whatsNext(sm, p.id);
    const b = await whatsNext(sm, p.id);
    expect(a.agent?.type).toBe(b.agent?.type);
    expect(a.currentState).toBe(b.currentState);
  });

  // -- ADR-024 Information Architect handoff coverage -----------------------
  it('fans out to @caia/info-architect at interview-complete', async () => {
    const p = await newProject();
    for (const target of [
      'idea-captured',
      'interviewing',
      'interview-complete',
    ] as const) {
      await sm.transition(p.id, target, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { target },
      });
    }
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(true);
    expect(r.agent?.type).toBe('@caia/info-architect');
    expect(r.agent?.producesArtifact).toBe('IaArtifactSet');
    expect(r.agent?.onSuccessTransitionTo).toBe(
      'information-architecture-in-progress',
    );
    expect(r.agent?.onFailureTransitionTo).toBe(
      'information-architecture-failed',
    );
  });

  it('continues running @caia/info-architect at IA-in-progress', async () => {
    const p = await newProject();
    for (const target of [
      'idea-captured',
      'interviewing',
      'interview-complete',
      'information-architecture-in-progress',
    ] as const) {
      await sm.transition(p.id, target, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { target },
      });
    }
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(true);
    expect(r.agent?.type).toBe('@caia/info-architect');
    expect(r.agent?.onSuccessTransitionTo).toBe(
      'information-architecture-complete',
    );
  });

  it('fans out to @caia/proposal-generator at IA-complete', async () => {
    const p = await newProject();
    for (const target of [
      'idea-captured',
      'interviewing',
      'interview-complete',
      'information-architecture-in-progress',
      'information-architecture-complete',
    ] as const) {
      await sm.transition(p.id, target, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { target },
      });
    }
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(true);
    expect(r.agent?.type).toBe('@caia/proposal-generator');
    expect(r.agent?.onSuccessTransitionTo).toBe('proposal-generated');
  });

  it('reports waiting-for-failure-recovery at information-architecture-failed', async () => {
    const p = await newProject();
    for (const target of [
      'idea-captured',
      'interviewing',
      'interview-complete',
      'information-architecture-failed',
    ] as const) {
      await sm.transition(p.id, target, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { target },
      });
    }
    const r = await whatsNext(sm, p.id);
    expect(r.hasWork).toBe(false);
    expect(r.waitingOn).toBe('waiting-for-failure-recovery');
  });
});

describe('resumePoint', () => {
  let sm: ReturnType<typeof buildInMemoryStateMachine>['sm'];
  beforeEach(async () => {
    ({ sm } = buildInMemoryStateMachine({ idempotencyWindowMs: 0 }));
    await sm.init();
  });
  const newProject = (slug = 'p') =>
    sm.createProject({ tenantId: 't', slug, displayName: slug });

  it('reports paused for a paused project', async () => {
    const p = await newProject();
    await sm.pause(p.id, 'op');
    const r = await resumePoint(sm, p.id);
    expect(r.reason).toBe('paused');
  });

  it('reports parked-at-failure for *-failed', async () => {
    const p = await newProject();
    await sm.transition(p.id, 'onboarding-failed', {
      reason: 'fail',
      triggeredBy: { kind: 'system', id: 'test' },
    });
    const r = await resumePoint(sm, p.id);
    expect(r.reason).toBe('parked-at-failure');
  });

  it('reports parked-at-failure for information-architecture-failed', async () => {
    const p = await newProject();
    for (const target of [
      'idea-captured',
      'interviewing',
      'interview-complete',
      'information-architecture-failed',
    ] as const) {
      await sm.transition(p.id, target, {
        reason: 'walk',
        triggeredBy: { kind: 'system', id: 'test' },
        payload: { target },
      });
    }
    const r = await resumePoint(sm, p.id);
    expect(r.reason).toBe('parked-at-failure');
  });

  it('reports steady-state for a fresh project (no history)', async () => {
    const p = await newProject();
    const r = await resumePoint(sm, p.id);
    expect(r.reason).toBe('steady-state');
    expect(r.lastHistoryId).toBeNull();
  });

  it('reports steady-state after happy transitions (history matches status)', async () => {
    const p = await newProject();
    await sm.transition(p.id, 'idea-captured', {
      reason: 'r',
      triggeredBy: { kind: 'system', id: 'test' },
    });
    const r = await resumePoint(sm, p.id);
    expect(r.reason).toBe('steady-state');
    expect(r.lastHistoryId).not.toBeNull();
  });
});
