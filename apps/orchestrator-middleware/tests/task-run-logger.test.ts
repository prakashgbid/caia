/**
 * Tests for the TASK-001 enforcement — TaskRunLogger.
 */

import { TaskRunLogger } from '../src/task-run-logger.js';
import type { TaskSpawnRecord } from '../src/types.js';

function makeRecord(sessionId: string): TaskSpawnRecord {
  return {
    sessionId,
    title: 'Test task',
    kind: 'task',
    cwd: '/tmp',
    prompt: 'Do something',
    startedAt: new Date().toISOString(),
  };
}

describe('TaskRunLogger', () => {
  let logger: TaskRunLogger;
  let fakeNow: number;

  beforeEach(() => {
    fakeNow = 1_000_000;
    logger = new TaskRunLogger(30_000);
    logger.setNow(() => fakeNow);
  });

  afterEach(() => {
    logger.reset();
  });

  describe('notifySpawned / getPendingAcknowledgements', () => {
    it('registers a session as pending after notifySpawned', () => {
      logger.notifySpawned('sess-1', 'task');
      expect(logger.getPendingAcknowledgements()).toContain('sess-1');
    });

    it('tracks multiple pending sessions independently', () => {
      logger.notifySpawned('sess-1', 'task');
      logger.notifySpawned('sess-2', 'code');
      const pending = logger.getPendingAcknowledgements();
      expect(pending).toContain('sess-1');
      expect(pending).toContain('sess-2');
    });
  });

  describe('recordSpawn', () => {
    it('clears session from pending when task_run_record is called', () => {
      logger.notifySpawned('sess-1', 'task');
      logger.recordSpawn(makeRecord('sess-1'));
      expect(logger.getPendingAcknowledgements()).not.toContain('sess-1');
    });

    it('handles recordSpawn for an unknown session gracefully', () => {
      expect(() => logger.recordSpawn(makeRecord('unknown'))).not.toThrow();
    });
  });

  describe('checkTtlViolations', () => {
    it('records no violation before TTL expires', () => {
      logger.notifySpawned('sess-1', 'task');
      fakeNow += 29_999; // just under 30 s
      logger.checkTtlViolations();
      expect(logger.getViolations()).toHaveLength(0);
      expect(logger.getPendingAcknowledgements()).toContain('sess-1');
    });

    it('records a TASK-001 violation after TTL expires', () => {
      logger.notifySpawned('sess-1', 'task');
      fakeNow += 30_001;
      logger.checkTtlViolations();
      const violations = logger.getViolations();
      expect(violations).toHaveLength(1);
      expect(violations[0]!.ruleId).toBe('TASK-001');
      expect(violations[0]!.severity).toBe('warn');
    });

    it('removes expired session from pending after violation is recorded', () => {
      logger.notifySpawned('sess-1', 'task');
      fakeNow += 30_001;
      logger.checkTtlViolations();
      expect(logger.getPendingAcknowledgements()).not.toContain('sess-1');
    });

    it('does not double-record violations on repeated checkTtlViolations calls', () => {
      logger.notifySpawned('sess-1', 'task');
      fakeNow += 31_000;
      logger.checkTtlViolations();
      logger.checkTtlViolations();
      expect(logger.getViolations()).toHaveLength(1);
    });
  });

  describe('getViolations', () => {
    it('returns an empty array when no violations have occurred', () => {
      expect(logger.getViolations()).toHaveLength(0);
    });

    it('returns a snapshot (copy) not the internal array', () => {
      logger.notifySpawned('sess-1', 'task');
      fakeNow += 30_001;
      logger.checkTtlViolations();
      const v1 = logger.getViolations();
      const v2 = logger.getViolations();
      expect(v1).not.toBe(v2);
      expect(v1).toEqual(v2);
    });
  });

  describe('reset', () => {
    it('clears pending, violations, and acknowledged sets', () => {
      logger.notifySpawned('sess-1', 'task');
      fakeNow += 31_000;
      logger.checkTtlViolations();
      logger.reset();
      expect(logger.getPendingAcknowledgements()).toHaveLength(0);
      expect(logger.getViolations()).toHaveLength(0);
    });
  });
});
