import { describe, expect, it } from 'vitest';

import { ConductorClient } from '../src/api.js';
import { MockPool } from './test-helpers.js';

function makeMvRow(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    project_id: 'p1', tenant_id: 't1', slug: 'my-project', display_name: 'My',
    status: 'coding-in-progress', paused: false, paused_at: null,
    last_transitioned_at: new Date('2026-05-24T00:00:00Z'),
    seconds_in_state: 600,
    active_agent_run_id: 'ar1', active_agent: 'worker-A',
    active_agent_claimed_at: new Date('2026-05-24T00:00:00Z'),
    active_agent_heartbeat_at: new Date('2026-05-24T00:09:30Z'),
    seconds_since_heartbeat: 30,
    refreshed_at: new Date('2026-05-24T00:10:00Z'),
    ...over,
  };
}

describe('ConductorClient.getProjectStatus', () => {
  it('returns null for unknown', async () => {
    const pool = new MockPool();
    const client = new ConductorClient({ db: pool as never });
    expect(await client.getProjectStatus('x')).toBeNull();
  });

  it('assembles status from mv + tables', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE project_id/, () => ({
      rows: [makeMvRow()],
    }));
    pool.on(/FROM caia_meta\.conductor_escalations[\s\S]*closed_at IS NULL/, () => ({ rows: [] }));
    pool.on(/FROM caia_meta\.state_history[\s\S]*ORDER BY id DESC/, () => ({
      rows: [{
        from_state: 'tests-reviewed', to_state: 'coding-in-progress',
        reason: 'scheduled', actor_kind: 'system', actor_id: 'orch',
        at: new Date('2026-05-24T00:00:00Z'),
      }],
    }));
    pool.on(/FROM caia_meta\.agent_runs[\s\S]*status = 'failed'/, () => ({ rows: [] }));
    pool.on(/percentile_cont/, () => ({ rows: [{ p50: 60, p90: 120, sample_size: 20 }] }));
    pool.on(/SELECT status FROM caia_meta\.tenant_projects/, () => ({
      rows: [{ status: 'coding-in-progress' }],
    }));
    const client = new ConductorClient({ db: pool as never });
    const r = await client.getProjectStatus('p1');
    expect(r).not.toBeNull();
    expect(r!.currentStage).toBe('coding-in-progress');
    expect(r!.activeAgents.length).toBe(1);
    expect(r!.recentTransitions.length).toBe(1);
  });

  it('paused project includes pausedSince', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE project_id/, () => ({
      rows: [makeMvRow({ paused: true, paused_at: new Date('2026-05-23T00:00:00Z') })],
    }));
    pool.on(/FROM caia_meta\.conductor_escalations/, () => ({ rows: [] }));
    pool.on(/FROM caia_meta\.state_history/, () => ({ rows: [] }));
    pool.on(/FROM caia_meta\.agent_runs/, () => ({ rows: [] }));
    pool.on(/percentile_cont/, () => ({ rows: [{ p50: 0, p90: 0, sample_size: 0 }] }));
    pool.on(/SELECT status FROM caia_meta\.tenant_projects/, () => ({ rows: [] }));
    const client = new ConductorClient({ db: pool as never });
    const r = await client.getProjectStatus('p1');
    expect(r!.paused).toBe(true);
    expect(r!.pausedSince).toBe('2026-05-23T00:00:00.000Z');
  });
});

describe('ConductorClient.listStuckProjects', () => {
  it('returns stuck projects sorted DESC', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*ORDER BY seconds_in_state DESC/, () => ({
      rows: [
        {
          project_id: 'p1', tenant_id: 't1', slug: 's1',
          status: 'coding-in-progress', seconds_in_state: 3_600,
          active_agent_heartbeat_at: new Date('2026-05-24T00:00:00Z'),
          open_escalations: 1,
        },
        {
          project_id: 'p2', tenant_id: 't1', slug: 's2',
          status: 'interview-complete', seconds_in_state: 2_400,
          active_agent_heartbeat_at: null, open_escalations: 0,
        },
      ],
    }));
    const client = new ConductorClient({ db: pool as never });
    const r = await client.listStuckProjects({ thresholdMinutes: 30 });
    expect(r.length).toBe(2);
    expect(r[0]!.projectId).toBe('p1');
    expect(r[0]!.openEscalations).toBe(1);
  });

  it('tenant-scoped queries', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status/, () => ({ rows: [] }));
    const client = new ConductorClient({ db: pool as never });
    await client.listStuckProjects({ thresholdMinutes: 30, scope: { tenantId: 't1' } });
    expect(pool.callsMatching(/AND tenant_id = \$2/).length).toBe(1);
  });

  it('empty when no stuck', async () => {
    const pool = new MockPool();
    const client = new ConductorClient({ db: pool as never });
    expect(await client.listStuckProjects({ thresholdMinutes: 30 })).toEqual([]);
  });
});

describe('ConductorClient.getStageHistory', () => {
  it('returns history rows', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.conductor_stage_durations/, () => ({
      rows: [{
        stage: 'coding-in-progress',
        entered_at: new Date('2026-05-24T00:00:00Z'),
        exited_at: new Date('2026-05-24T00:10:00Z'),
        duration_seconds: 600, exit_reason: 'succeeded', retry_count: 0,
      }],
    }));
    const client = new ConductorClient({ db: pool as never });
    const r = await client.getStageHistory('p1');
    expect(r.length).toBe(1);
    expect(r[0]!.exitReason).toBe('succeeded');
  });

  it('respects stage filter', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.conductor_stage_durations/, () => ({ rows: [] }));
    const client = new ConductorClient({ db: pool as never });
    await client.getStageHistory('p1', { stage: 'coding-in-progress' });
    expect(pool.callsMatching(/AND stage = \$2/).length).toBe(1);
  });

  it('caps limit at 500', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.conductor_stage_durations/, () => ({ rows: [] }));
    const client = new ConductorClient({ db: pool as never });
    await client.getStageHistory('p1', { limit: 10_000 });
    const calls = pool.callsMatching(/LIMIT \$/);
    expect(calls[0]!.params).toContain(500);
  });
});

describe('ConductorClient.getPipelineHealth', () => {
  it('rolls up + computes bottlenecks', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*GROUP BY status/, () => ({
      rows: [
        { status: 'coding-in-progress', count: '3', p50_dwell: '100', p90_dwell: '500', stuck: '2' },
        { status: 'interview-complete', count: '5', p50_dwell: '50', p90_dwell: '200', stuck: '0' },
      ],
    }));
    pool.on(/FROM caia_meta\.conductor_escalations e/, () => ({ rows: [{ n: '2' }] }));
    pool.on(/FROM caia_meta\.agent_runs ar/, () => ({ rows: [{ n: '1' }] }));
    const client = new ConductorClient({ db: pool as never });
    const r = await client.getPipelineHealth({ windowMinutes: 60 });
    expect(r.activeProjects).toBe(8);
    expect(r.byStage['coding-in-progress']!.stuck).toBe(2);
    expect(r.openEscalations).toBe(2);
    expect(r.recentFailures).toBe(1);
    expect(r.bottlenecks).toContainEqual({
      stage: 'coding-in-progress', severity: 'critical',
    });
  });

  it('caches results', async () => {
    const pool = new MockPool();
    let n = 0;
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*GROUP BY status/, () => {
      n += 1;
      return { rows: [] };
    });
    pool.on(/FROM caia_meta\.conductor_escalations e/, () => ({ rows: [{ n: '0' }] }));
    pool.on(/FROM caia_meta\.agent_runs ar/, () => ({ rows: [{ n: '0' }] }));
    const client = new ConductorClient({ db: pool as never, healthCacheMs: 60_000 });
    await client.getPipelineHealth({ windowMinutes: 60 });
    await client.getPipelineHealth({ windowMinutes: 60 });
    expect(n).toBe(1);
  });

  it('clearHealthCache forces refresh', async () => {
    const pool = new MockPool();
    let n = 0;
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*GROUP BY status/, () => {
      n += 1;
      return { rows: [] };
    });
    pool.on(/FROM caia_meta\.conductor_escalations e/, () => ({ rows: [{ n: '0' }] }));
    pool.on(/FROM caia_meta\.agent_runs ar/, () => ({ rows: [{ n: '0' }] }));
    const client = new ConductorClient({ db: pool as never, healthCacheMs: 60_000 });
    await client.getPipelineHealth({ windowMinutes: 60 });
    client.clearHealthCache();
    await client.getPipelineHealth({ windowMinutes: 60 });
    expect(n).toBe(2);
  });
});

describe('ConductorClient.escalate', () => {
  it('opens an escalation', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE project_id/, () => ({
      rows: [{ seconds_in_state: 1_234 }],
    }));
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => ({
      rows: [{ id: 'esc-new' }],
    }));
    const client = new ConductorClient({ db: pool as never });
    const r = await client.escalate({
      projectId: 'p1', stage: 'coding-in-progress', reason: 'manual',
    });
    expect(r.escalationId).toBe('esc-new');
    expect(r.alreadyOpen).toBe(false);
  });

  it('alreadyOpen=true on duplicate', async () => {
    const pool = new MockPool();
    pool.on(/FROM caia_meta\.mv_pipeline_status[\s\S]*WHERE project_id/, () => ({
      rows: [{ seconds_in_state: 100 }],
    }));
    pool.on(/INSERT INTO caia_meta\.conductor_escalations/, () => ({ rows: [] }));
    const client = new ConductorClient({ db: pool as never });
    const r = await client.escalate({
      projectId: 'p1', stage: 'coding-in-progress', reason: 'manual',
    });
    expect(r.alreadyOpen).toBe(true);
    expect(r.escalationId).toBe('');
  });
});

describe('ConductorClient.closeEscalation', () => {
  it('closes an open escalation', async () => {
    const pool = new MockPool();
    pool.on(/UPDATE caia_meta\.conductor_escalations/, () => ({
      rows: [{ project_id: 'p1' }],
    }));
    const client = new ConductorClient({ db: pool as never });
    expect((await client.closeEscalation('e', { resolution: 'completed' })).ok).toBe(true);
  });

  it('ok=false for unknown', async () => {
    const pool = new MockPool();
    pool.on(/UPDATE caia_meta\.conductor_escalations/, () => ({ rows: [] }));
    const client = new ConductorClient({ db: pool as never });
    expect((await client.closeEscalation('x', { resolution: 'completed' })).ok).toBe(false);
  });
});

describe('ConductorClient.subscribeToProject', () => {
  it('throws without StateMachine', async () => {
    const pool = new MockPool();
    const client = new ConductorClient({ db: pool as never });
    await expect(client.subscribeToProject('p1', () => undefined))
      .rejects.toThrow(/StateMachine/);
  });
});
