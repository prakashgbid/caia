import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Projector } from '../src/projector.js';
import { MockPool } from './test-helpers.js';
import { eventBus, EVENT_SEVERITY } from '@chiefaia/event-bus-internal';
import type { ConductorEvent } from '@chiefaia/event-bus-internal';

describe('Conductor event emission', () => {
  let pool: MockPool;
  let projector: Projector;
  let captured: ConductorEvent[];
  let unsub: () => void;

  beforeEach(() => {
    pool = new MockPool();
    projector = new Projector({ pool: pool as never, disableWatchdog: true });
    captured = [];
    unsub = eventBus.subscribe('conductor.*', (e) => captured.push(e));
  });

  afterEach(() => {
    unsub();
    projector.stop();
  });

  it('emits conductor.escalation.opened on new escalation', async () => {
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => ({
      rows: [{ id: 'esc-1' }],
    }));
    await projector.openEscalation({
      projectId: 'p1', stage: 'coding-in-progress',
      reason: 'no-heartbeat', thresholdSeconds: 1_800,
      elapsedSeconds: 2_000, lastEventId: 'ev_42',
    });
    const opened = captured.filter((e) => e.type === 'conductor.escalation.opened');
    expect(opened.length).toBe(1);
    expect(opened[0]!.payload).toMatchObject({
      project_id: 'p1',
      stage: 'coding-in-progress',
      reason: 'no-heartbeat',
    });
  });

  it('does NOT emit on duplicate', async () => {
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => ({ rows: [] }));
    await projector.openEscalation({
      projectId: 'p1', stage: 'coding-in-progress',
      reason: 'no-heartbeat', thresholdSeconds: 1_800,
      elapsedSeconds: 2_000, lastEventId: null,
    });
    expect(captured.length).toBe(0);
  });

  it('emits conductor.escalation.closed with resolution', async () => {
    pool.on(/UPDATE caia_meta\.conductor_escalations/, () => ({
      rows: [{ project_id: 'p1' }],
    }));
    await projector.closeEscalation('esc-1', 'completed');
    expect(captured.filter((e) => e.type === 'conductor.escalation.closed').length).toBe(1);
  });

  it('emitted event has actor=pipeline-conductor', async () => {
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => ({
      rows: [{ id: 'esc-1' }],
    }));
    await projector.openEscalation({
      projectId: 'p1', stage: 'coding-in-progress',
      reason: 'no-heartbeat', thresholdSeconds: 1_800,
      elapsedSeconds: 2_000, lastEventId: null,
    });
    expect(captured[0]!.actor).toBe('pipeline-conductor');
  });

  it('emitted event severity matches EVENT_SEVERITY map', async () => {
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => ({
      rows: [{ id: 'esc-1' }],
    }));
    pool.on(/UPDATE caia_meta\.conductor_escalations/, () => ({
      rows: [{ project_id: 'p1' }],
    }));
    await projector.openEscalation({
      projectId: 'p1', stage: 'coding-in-progress',
      reason: 'no-heartbeat', thresholdSeconds: 1_800,
      elapsedSeconds: 2_000, lastEventId: null,
    });
    expect(captured[0]!.severity).toBe(EVENT_SEVERITY['conductor.escalation.opened']);
    expect(captured[0]!.severity).toBe('warning');
    await projector.closeEscalation('esc-1', 'completed');
    expect(captured[1]!.severity).toBe('info');
  });
});

describe('Event taxonomy registry', () => {
  it('has 4 conductor.* types registered with severity', () => {
    expect(EVENT_SEVERITY['conductor.escalation.opened']).toBe('warning');
    expect(EVENT_SEVERITY['conductor.escalation.closed']).toBe('info');
    expect(EVENT_SEVERITY['conductor.forecast.updated']).toBe('info');
    expect(EVENT_SEVERITY['conductor.pipeline-bottleneck.detected']).toBe('warning');
  });
});
