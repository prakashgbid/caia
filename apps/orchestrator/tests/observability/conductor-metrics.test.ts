import { ConductorMetrics } from '../../src/observability/conductor-metrics';

describe('ConductorMetrics', () => {
  let m: ConductorMetrics;

  beforeEach(() => {
    m = new ConductorMetrics();
  });

  describe('task lifecycle — active gauge transitions', () => {
    it('increments queued gauge on recordTaskAdded', () => {
      m.recordTaskAdded('user');
      expect(m.getActiveCount({ status: 'queued' })).toBe(1);
    });

    it('queued → running on recordTaskStarted', () => {
      m.recordTaskAdded('claude');
      m.recordTaskStarted();
      expect(m.getActiveCount({ status: 'queued' })).toBe(0);
      expect(m.getActiveCount({ status: 'running' })).toBe(1);
    });

    it('queued → blocked on recordTaskBlocked', () => {
      m.recordTaskAdded('hook');
      m.recordTaskBlocked();
      expect(m.getActiveCount({ status: 'queued' })).toBe(0);
      expect(m.getActiveCount({ status: 'blocked' })).toBe(1);
    });

    it('blocked → queued on recordTaskUnblocked', () => {
      m.recordTaskAdded('user');
      m.recordTaskBlocked();
      m.recordTaskUnblocked();
      expect(m.getActiveCount({ status: 'blocked' })).toBe(0);
      expect(m.getActiveCount({ status: 'queued' })).toBe(1);
    });

    it('clears running on terminal completion', () => {
      m.recordTaskAdded('user');
      m.recordTaskStarted();
      m.recordTaskTerminated('completed', 'user');
      expect(m.getActiveCount({ status: 'running' })).toBe(0);
    });
  });

  describe('terminal task counters', () => {
    it('increments completed counter', () => {
      m.recordTaskAdded('user');
      m.recordTaskStarted();
      m.recordTaskTerminated('completed', 'user');
      expect(m.getTasksTotal({ status: 'completed', spawned_by: 'user' })).toBe(1);
    });

    it('increments failed counter', () => {
      m.recordTaskAdded('claude');
      m.recordTaskStarted();
      m.recordTaskTerminated('failed', 'claude');
      expect(m.getTasksTotal({ status: 'failed', spawned_by: 'claude' })).toBe(1);
    });

    it('increments cancelled counter', () => {
      m.recordTaskAdded('hook');
      m.recordTaskStarted();
      m.recordTaskTerminated('cancelled', 'hook');
      expect(m.getTasksTotal({ status: 'cancelled', spawned_by: 'hook' })).toBe(1);
    });

    it('accumulates multiple completions across different origins', () => {
      m.recordTaskAdded('user');
      m.recordTaskStarted();
      m.recordTaskTerminated('completed', 'user');
      m.recordTaskAdded('claude');
      m.recordTaskStarted();
      m.recordTaskTerminated('completed', 'claude');
      expect(m.getTasksTotal({ status: 'completed', spawned_by: 'user' })).toBe(1);
      expect(m.getTasksTotal({ status: 'completed', spawned_by: 'claude' })).toBe(1);
    });
  });

  describe('duration histogram', () => {
    it('records duration when startedAt is provided', () => {
      const startedAt = new Date(Date.now() - 500).toISOString();
      m.recordTaskAdded('user');
      m.recordTaskStarted();
      m.recordTaskTerminated('completed', 'user', startedAt);
      expect(m.getDurationCount({ status: 'completed', spawned_by: 'user' })).toBe(1);
      expect(m.getDurationSum({ status: 'completed', spawned_by: 'user' })).toBeGreaterThan(0);
    });

    it('skips duration observation when startedAt is absent', () => {
      m.recordTaskAdded('user');
      m.recordTaskStarted();
      m.recordTaskTerminated('completed', 'user');
      expect(m.getDurationCount({ status: 'completed', spawned_by: 'user' })).toBe(0);
    });
  });

  describe('event counters', () => {
    it('counts TASK_ADDED events', () => {
      m.recordTaskAdded('user');
      expect(m.getEventsTotal({ type: 'TASK_ADDED' })).toBe(1);
    });

    it('counts TASK_STARTED events', () => {
      m.recordTaskAdded('user');
      m.recordTaskStarted();
      expect(m.getEventsTotal({ type: 'TASK_STARTED' })).toBe(1);
    });

    it('counts TASK_COMPLETED events', () => {
      m.recordTaskAdded('user');
      m.recordTaskStarted();
      m.recordTaskTerminated('completed', 'user');
      expect(m.getEventsTotal({ type: 'TASK_COMPLETED' })).toBe(1);
    });
  });

  describe('pump metrics', () => {
    it('counts ticks regardless of pick outcome', () => {
      m.recordPumpTick(false);
      m.recordPumpTick(false);
      m.recordPumpTick(true);
      expect(m.getPumpTicks()).toBe(3);
      expect(m.getPumpPicked()).toBe(1);
    });

    it('does not count picked when tick yields nothing', () => {
      m.recordPumpTick(false);
      expect(m.getPumpPicked()).toBe(0);
    });
  });

  describe('reconcile drift counter', () => {
    it('accumulates drifted task count', () => {
      m.recordReconcileDrift(2);
      m.recordReconcileDrift(1);
      expect(m.getReconcileDriftedTotal()).toBe(3);
    });

    it('ignores zero and negative counts', () => {
      m.recordReconcileDrift(0);
      m.recordReconcileDrift(-1);
      expect(m.getReconcileDriftedTotal()).toBe(0);
    });
  });

  describe('TTL expiry counter', () => {
    it('accumulates expired task count', () => {
      m.recordTtlExpired(3);
      expect(m.getTasksTtlExpiredTotal()).toBe(3);
    });

    it('ignores zero and negative counts', () => {
      m.recordTtlExpired(0);
      expect(m.getTasksTtlExpiredTotal()).toBe(0);
    });
  });

  describe('lock conflict counter', () => {
    it('accumulates conflict count from task adds', () => {
      m.recordLockConflict(1);
      m.recordLockConflict(2);
      expect(m.getLockConflictsTotal()).toBe(3);
    });

    it('ignores zero and negative counts', () => {
      m.recordLockConflict(0);
      expect(m.getLockConflictsTotal()).toBe(0);
    });
  });

  describe('render()', () => {
    it('returns non-empty Prometheus text output containing registered metrics', async () => {
      m.recordTaskAdded('user');
      const output = await m.render();
      expect(output).toContain('conductor_tasks_active');
      expect(output).toContain('conductor_events_total');
      expect(output).toContain('conductor_pump_ticks_total');
      expect(output).toContain('conductor_reconcile_drifted_total');
      expect(output).toContain('conductor_tasks_ttl_expired_total');
      expect(output).toContain('conductor_lock_conflicts_total');
    });

    it('contentType returns a Prometheus-compatible media type', () => {
      expect(m.contentType()).toMatch(/text\/plain/);
    });
  });
});
