/**
 * Contract: TASK-001
 * Verifies: unacknowledged spawns are detected; acknowledged spawns are clean.
 *
 * The TaskRunLogger has an injectable clock (`setNow`) to allow deterministic
 * time-travel in tests without real timers.
 */

import { TaskRunLogger } from '../../apps/orchestrator-middleware/src/task-run-logger';
import type { TaskSpawnRecord } from '../../apps/orchestrator-middleware/src/types';

function makeRecord(overrides: Partial<TaskSpawnRecord> = {}): TaskSpawnRecord {
  return {
    sessionId: 'sess-001',
    title: 'Test task',
    kind: 'task',
    cwd: '/tmp',
    prompt: 'Do some work',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('TaskRunLogger contract (TASK-001)', () => {
  let logger: TaskRunLogger;

  beforeEach(() => {
    // Use a 1 000 ms TTL so we can fast-forward time cheaply in tests.
    logger = new TaskRunLogger(1_000);
  });

  afterEach(() => {
    logger.reset();
  });

  describe('notifySpawned + checkTtlViolations', () => {
    it('should report a violation when a spawn is not acknowledged before the TTL', () => {
      let fakeNow = 0;
      logger.setNow(() => fakeNow);

      logger.notifySpawned('sess-timeout', 'task');

      // Advance clock past TTL
      fakeNow = 2_000;
      logger.checkTtlViolations();

      const violations = logger.getViolations();
      expect(violations.length).toBeGreaterThan(0);
      expect(violations[0]!.ruleId).toBe('TASK-001');
      expect(violations[0]!.context['sessionId']).toBe('sess-timeout');
    });

    it('should report no violation when a spawn is acknowledged before the TTL', () => {
      let fakeNow = 0;
      logger.setNow(() => fakeNow);

      logger.notifySpawned('sess-ack', 'code');
      logger.recordSpawn(makeRecord({ sessionId: 'sess-ack', kind: 'code' }));

      // Advance clock past TTL — should not create a violation because the session
      // was already acknowledged.
      fakeNow = 2_000;
      logger.checkTtlViolations();

      expect(logger.getViolations()).toHaveLength(0);
    });
  });

  describe('getPendingAcknowledgements', () => {
    it('should return unacknowledged session IDs', () => {
      logger.notifySpawned('sess-a', 'task');
      logger.notifySpawned('sess-b', 'code');

      const pending = logger.getPendingAcknowledgements();
      expect(pending).toContain('sess-a');
      expect(pending).toContain('sess-b');
      expect(pending).toHaveLength(2);
    });

    it('should not return session IDs that have been acknowledged', () => {
      logger.notifySpawned('sess-c', 'task');
      logger.recordSpawn(makeRecord({ sessionId: 'sess-c' }));

      const pending = logger.getPendingAcknowledgements();
      expect(pending).not.toContain('sess-c');
    });
  });

  describe('recordSpawn', () => {
    it('should remove the session from pending acknowledgements', () => {
      logger.notifySpawned('sess-remove', 'task');
      expect(logger.getPendingAcknowledgements()).toContain('sess-remove');

      logger.recordSpawn(makeRecord({ sessionId: 'sess-remove' }));
      expect(logger.getPendingAcknowledgements()).not.toContain('sess-remove');
    });
  });

  describe('multiple spawns', () => {
    it('should handle multiple concurrent spawns independently', () => {
      let fakeNow = 0;
      logger.setNow(() => fakeNow);

      logger.notifySpawned('sess-x', 'task');
      logger.notifySpawned('sess-y', 'code');
      logger.notifySpawned('sess-z', 'task');

      // Acknowledge one of them
      logger.recordSpawn(makeRecord({ sessionId: 'sess-y', kind: 'code' }));

      // Advance clock — sess-x and sess-z should violate; sess-y should not
      fakeNow = 2_000;
      logger.checkTtlViolations();

      const violations = logger.getViolations();
      const violatingSessions = violations.map(v => v.context['sessionId'] as string);

      expect(violatingSessions).toContain('sess-x');
      expect(violatingSessions).toContain('sess-z');
      expect(violatingSessions).not.toContain('sess-y');
    });
  });

  describe('reset', () => {
    it('should clear all internal state', () => {
      let fakeNow = 0;
      logger.setNow(() => fakeNow);

      logger.notifySpawned('sess-reset', 'task');
      fakeNow = 2_000;
      logger.checkTtlViolations();

      expect(logger.getViolations().length).toBeGreaterThan(0);

      logger.reset();

      expect(logger.getViolations()).toHaveLength(0);
      expect(logger.getPendingAcknowledgements()).toHaveLength(0);
    });
  });

  describe('violation shape', () => {
    it('violation should carry the expected fields', () => {
      let fakeNow = 0;
      logger.setNow(() => fakeNow);

      logger.notifySpawned('sess-shape', 'code');
      fakeNow = 2_000;
      logger.checkTtlViolations();

      const v = logger.getViolations()[0]!;
      expect(v.ruleId).toBe('TASK-001');
      expect(v.severity).toBe('warn');
      expect(typeof v.message).toBe('string');
      expect(typeof v.timestamp).toBe('string');
      expect(v.context['kind']).toBe('code');
      expect(typeof v.context['elapsedMs']).toBe('number');
    });
  });
});
