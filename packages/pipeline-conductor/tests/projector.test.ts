import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Projector } from '../src/projector.js';
import { MockPool } from './test-helpers.js';
import { eventBus } from '@chiefaia/event-bus-internal';

describe('Projector — event handling', () => {
  let pool: MockPool;
  let projector: Projector;

  beforeEach(() => {
    pool = new MockPool();
    projector = new Projector({
      pool: pool as never,
      disableWatchdog: true,
      refreshDebounceMs: 50,
    });
  });

  afterEach(() => { projector.stop(); });

  it('eventsObserved increments', async () => {
    await projector.handleEvent({
      id: 'ev_1', type: 'task.completed',
      occurred_at: new Date().toISOString(), actor: 'worker', severity: 'info',
      payload: { task_id: 't', project_id: 'p1' },
    });
    expect(projector.eventsObserved).toBe(1);
  });

  it('persists cursor', async () => {
    await projector.handleEvent({
      id: 'ev_cursor', type: 'worker.heartbeat',
      occurred_at: new Date().toISOString(), actor: 'worker', severity: 'debug',
      payload: { project_id: 'p1' },
    });
    const cc = pool.callsMatching(/conductor_projector_cursor/);
    expect(cc.length).toBeGreaterThan(0);
    expect(cc[0]!.params).toContain('ev_cursor');
  });

  it('worker.heartbeat → UPDATE agent_runs', async () => {
    await projector.handleEvent({
      id: 'ev_h', type: 'worker.heartbeat',
      occurred_at: new Date().toISOString(), actor: 'worker', severity: 'debug',
      payload: { project_id: 'p1', worker_id: 'w' },
    });
    expect(pool.callsMatching(/agent_runs[\s\S]*heartbeat_at = now/).length).toBe(1);
  });

  it('task.started → INSERT agent_runs', async () => {
    await projector.handleEvent({
      id: 'ev_c', type: 'task.started',
      occurred_at: new Date().toISOString(), actor: 'worker', severity: 'info',
      payload: { project_id: 'p1', worker_pid: 1, worktree_path: '/t' },
    });
    expect(pool.callsMatching(/INSERT INTO caia_meta\.agent_runs/).length).toBe(1);
  });

  it('no-op when no project_id', async () => {
    await projector.handleEvent({
      id: 'ev_no', type: 'worker.heartbeat',
      occurred_at: new Date().toISOString(), actor: 'worker', severity: 'debug',
      payload: {},
    });
    expect(pool.callsMatching(/UPDATE caia_meta\.agent_runs/).length).toBe(0);
  });

  it('extracts projectId from entity_id', async () => {
    await projector.handleEvent({
      id: 'ev_e', type: 'worker.heartbeat',
      occurred_at: new Date().toISOString(), actor: 'worker', severity: 'debug',
      entity_type: 'project', entity_id: 'p-eid', payload: {},
    });
    const calls = pool.callsMatching(/UPDATE caia_meta\.agent_runs/);
    expect(calls[0]!.params[0]).toBe('p-eid');
  });

  it('task.failed updates to failed', async () => {
    pool.on(/SELECT status FROM caia_meta\.tenant_projects/, () => ({
      rows: [{ status: 'coding-in-progress' }],
    }));
    pool.on(/count\(\*\)::TEXT AS n[\s\S]*agent_runs/, () => ({ rows: [{ n: '1' }] }));
    await projector.handleEvent({
      id: 'ev_f', type: 'task.failed',
      occurred_at: new Date().toISOString(), actor: 'worker', severity: 'error',
      payload: { project_id: 'p1', failure_reason: 'x', attempt_n: 1 },
    });
    expect(pool.callsMatching(/SET status = 'failed'/).length).toBe(1);
  });

  it('refreshCount starts at 0', () => {
    expect(projector.refreshCount).toBe(0);
  });

  it('start() idempotent', () => {
    projector.start();
    projector.start();
    projector.stop();
  });

  it('stop() idempotent', () => {
    projector.stop();
    projector.stop();
  });

  it('counters cumulate', async () => {
    for (let i = 0; i < 5; i++) {
      await projector.handleEvent({
        id: `ev_${i}`, type: 'worker.heartbeat',
        occurred_at: new Date().toISOString(), actor: 'worker', severity: 'debug',
        payload: { project_id: 'p1' },
      });
    }
    expect(projector.eventsObserved).toBe(5);
  });
});

describe('Projector — escalations', () => {
  it('openEscalation alreadyOpen on duplicate', async () => {
    const pool = new MockPool();
    let i = 0;
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => {
      i += 1;
      return i === 1 ? { rows: [{ id: 'esc-1' }] } : { rows: [] };
    });
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    const first = await projector.openEscalation({
      projectId: 'p1', stage: 'coding-in-progress',
      reason: 'no-heartbeat', thresholdSeconds: 1_800,
      elapsedSeconds: 2_000, lastEventId: null,
    });
    const second = await projector.openEscalation({
      projectId: 'p1', stage: 'coding-in-progress',
      reason: 'no-heartbeat', thresholdSeconds: 1_800,
      elapsedSeconds: 3_000, lastEventId: null,
    });
    expect(first.alreadyOpen).toBe(false);
    expect(first.escalationId).toBe('esc-1');
    expect(second.alreadyOpen).toBe(true);
  });

  it('closeEscalation false for unknown', async () => {
    const pool = new MockPool();
    pool.on(/UPDATE caia_meta\.conductor_escalations/, () => ({ rows: [] }));
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    expect(await projector.closeEscalation('x', 'completed')).toBe(false);
  });

  it('closeEscalation true + emits event', async () => {
    const pool = new MockPool();
    pool.on(/UPDATE caia_meta\.conductor_escalations/, () => ({
      rows: [{ project_id: 'p1' }],
    }));
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    const captured: unknown[] = [];
    const unsub = eventBus.subscribe('conductor.escalation.closed', (e) => captured.push(e));
    try {
      const ok = await projector.closeEscalation('esc', 'resumed');
      expect(ok).toBe(true);
      expect(captured.length).toBe(1);
    } finally {
      unsub();
    }
  });
});

describe('Projector — watchdog', () => {
  it('opens escalation for stuck rows', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE paused = false/, () => ({
      rows: [{
        project_id: 'p1', tenant_id: 't1', status: 'coding-in-progress',
        paused: false, seconds_in_state: 60,
        active_agent_run_id: 'ar1', seconds_since_heartbeat: 2_000,
      }],
    }));
    let inserted = false;
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => {
      inserted = true;
      return { rows: [{ id: 'new-esc' }] };
    });
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    await projector.runWatchdog();
    expect(inserted).toBe(true);
  });

  it('skips paused rows', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE paused = false/, () => ({
      rows: [{
        project_id: 'p1', tenant_id: 't1', status: 'coding-in-progress',
        paused: true, seconds_in_state: 999_999,
        active_agent_run_id: null, seconds_since_heartbeat: 999_999,
      }],
    }));
    let inserted = false;
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => {
      inserted = true;
      return { rows: [{ id: 'x' }] };
    });
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    await projector.runWatchdog();
    expect(inserted).toBe(false);
  });

  it('skips unknown statuses', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE paused = false/, () => ({
      rows: [{
        project_id: 'p1', tenant_id: 't1', status: 'archived',
        paused: false, seconds_in_state: 999_999,
        active_agent_run_id: null, seconds_since_heartbeat: null,
      }],
    }));
    let inserted = false;
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => {
      inserted = true;
      return { rows: [{ id: 'x' }] };
    });
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    await projector.runWatchdog();
    expect(inserted).toBe(false);
  });
});
