import { describe, expect, it } from 'vitest';

import { Projector } from '../src/projector.js';
import { ConductorClient } from '../src/api.js';
import { MockPool } from './test-helpers.js';

describe('Projector idempotency', () => {
  it('replays same event twice without crashing', async () => {
    const pool = new MockPool();
    pool.on(/INSERT INTO caia_meta\.agent_runs/, () => ({ rows: [] }));
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    const evt = {
      id: 'ev_dup', type: 'task.started' as const,
      occurred_at: new Date().toISOString(), actor: 'worker' as const,
      severity: 'info' as const,
      payload: { project_id: 'p1', worker_pid: 1, worktree_path: '/x' },
    };
    await projector.handleEvent(evt);
    await projector.handleEvent(evt);
    expect(projector.eventsObserved).toBe(2);
  });

  it('openEscalation idempotent on retry', async () => {
    const pool = new MockPool();
    let i = 0;
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => {
      i += 1;
      return i === 1 ? { rows: [{ id: 'esc' }] } : { rows: [] };
    });
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    const args = {
      projectId: 'p1', stage: 'coding-in-progress' as const,
      reason: 'no-heartbeat', thresholdSeconds: 1_800,
      elapsedSeconds: 2_000, lastEventId: null,
    };
    const r1 = await projector.openEscalation(args);
    const r2 = await projector.openEscalation(args);
    expect(r1.alreadyOpen).toBe(false);
    expect(r2.alreadyOpen).toBe(true);
  });

  it('escalate via client surface idempotent', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE project_id/, () => ({
      rows: [{ seconds_in_state: 100 }],
    }));
    let i = 0;
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => {
      i += 1;
      return i === 1 ? { rows: [{ id: 'esc' }] } : { rows: [] };
    });
    const client = new ConductorClient({ db: pool as never });
    const args = {
      projectId: 'p1', stage: 'coding-in-progress' as const, reason: 'manual',
    };
    const a = await client.escalate(args);
    const b = await client.escalate(args);
    expect(a.alreadyOpen).toBe(false);
    expect(b.alreadyOpen).toBe(true);
  });

  it('closeEscalation on already-closed returns false', async () => {
    const pool = new MockPool();
    let i = 0;
    pool.on(/UPDATE caia_meta\.conductor_escalations/, () => {
      i += 1;
      return i === 1 ? { rows: [{ project_id: 'p' }] } : { rows: [] };
    });
    const projector = new Projector({ pool: pool as never, disableWatchdog: true });
    expect(await projector.closeEscalation('e', 'completed')).toBe(true);
    expect(await projector.closeEscalation('e', 'completed')).toBe(false);
  });
});
