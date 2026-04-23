/**
 * Integration contract — combines all three middleware enforcement pieces.
 *
 * Tests the `createOrchestrationGuard` factory and verifies that the returned
 * guard correctly delegates to, and aggregates across, all sub-components.
 */

import {
  createOrchestrationGuard,
} from '../../apps/orchestrator-middleware/src/index';
import { BannedPhraseError, MissingRootPromptError } from '../../apps/orchestrator-middleware/src/errors';
import type { OrchestrationGuard } from '../../apps/orchestrator-middleware/src/index';
import type { TaskSpawnRecord } from '../../apps/orchestrator-middleware/src/types';

function makeRecord(overrides: Partial<TaskSpawnRecord> = {}): TaskSpawnRecord {
  return {
    sessionId: 'sess-guard-001',
    title: 'Guard test task',
    kind: 'task',
    cwd: '/tmp',
    prompt: 'Work with files',
    startedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('createOrchestrationGuard integration contract', () => {
  let guard: OrchestrationGuard;

  beforeEach(() => {
    // Short TTL so we can fast-forward time to trigger TASK-001 violations.
    guard = createOrchestrationGuard(500);
  });

  afterEach(() => {
    guard.reset();
  });

  describe('createOrchestrationGuard factory', () => {
    it('should return a guard object with the expected interface', () => {
      expect(guard.promptContext).toBeDefined();
      expect(guard.taskRunLogger).toBeDefined();
      expect(typeof guard.scanMessage).toBe('function');
      expect(typeof guard.assertMessageClean).toBe('function');
      expect(typeof guard.getAllViolations).toBe('function');
      expect(typeof guard.reset).toBe('function');
    });
  });

  describe('scanMessage delegation', () => {
    it('should detect banned phrases via scanMessage', () => {
      const result = guard.scanMessage('Should I proceed?');
      expect(result.clean).toBe(false);
      expect(result.violations.length).toBeGreaterThan(0);
    });

    it('should return clean result for a decisive message', () => {
      const result = guard.scanMessage('Decided: running tests. Rationale: CI gate. In flight: test run.');
      expect(result.clean).toBe(true);
    });
  });

  describe('assertMessageClean delegation', () => {
    it('should throw BannedPhraseError for a message with banned phrase', () => {
      expect(() => guard.assertMessageClean('Should I restart?')).toThrow(BannedPhraseError);
    });

    it('should not throw for a clean message', () => {
      expect(() =>
        guard.assertMessageClean('Decided: restarting. Rationale: OOM. In flight: restart.'),
      ).not.toThrow();
    });
  });

  describe('getAllViolations — aggregation', () => {
    it('should return an empty array when there are no violations', () => {
      expect(guard.getAllViolations()).toHaveLength(0);
    });

    it('should aggregate TRACE-001 violations from promptContext', () => {
      try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }

      const violations = guard.getAllViolations();
      const traceViolations = violations.filter(v => v.ruleId === 'TRACE-001');
      expect(traceViolations.length).toBeGreaterThan(0);
    });

    it('should aggregate TASK-001 violations from taskRunLogger', () => {
      let fakeNow = 0;
      guard.taskRunLogger.setNow(() => fakeNow);
      guard.taskRunLogger.notifySpawned('sess-ttl', 'task');

      // Advance clock past the 500 ms TTL configured for this guard instance
      fakeNow = 1_000;
      // getAllViolations triggers checkTtlViolations internally
      const violations = guard.getAllViolations();

      const taskViolations = violations.filter(v => v.ruleId === 'TASK-001');
      expect(taskViolations.length).toBeGreaterThan(0);
    });

    it('should aggregate violations from multiple sub-components at once', () => {
      // Trigger a TRACE-001 violation
      try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }

      // Trigger a TASK-001 violation
      let fakeNow = 0;
      guard.taskRunLogger.setNow(() => fakeNow);
      guard.taskRunLogger.notifySpawned('sess-multi', 'code');
      fakeNow = 1_000;

      const violations = guard.getAllViolations();
      const ruleIds = violations.map(v => v.ruleId);

      expect(ruleIds).toContain('TRACE-001');
      expect(ruleIds).toContain('TASK-001');
    });

    it('should return violations sorted by timestamp ascending', () => {
      // Generate two violations in controlled order
      try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }

      let fakeNow = Date.now() + 5_000; // ensure this is later
      guard.taskRunLogger.setNow(() => fakeNow);
      guard.taskRunLogger.notifySpawned('sess-order', 'task');
      fakeNow += 1_000;

      const violations = guard.getAllViolations();
      if (violations.length > 1) {
        for (let i = 1; i < violations.length; i++) {
          expect(violations[i]!.timestamp >= violations[i - 1]!.timestamp).toBe(true);
        }
      }
    });
  });

  describe('reset', () => {
    it('should clear all violations from all sub-components', () => {
      // Trigger violations in both sub-components
      try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }

      let fakeNow = 0;
      guard.taskRunLogger.setNow(() => fakeNow);
      guard.taskRunLogger.notifySpawned('sess-clear', 'task');
      fakeNow = 1_000;
      guard.getAllViolations(); // triggers checkTtlViolations

      expect(guard.getAllViolations().length).toBeGreaterThan(0);

      guard.reset();

      expect(guard.getAllViolations()).toHaveLength(0);
      expect(guard.promptContext.getRootPromptId()).toBeUndefined();
      expect(guard.taskRunLogger.getPendingAcknowledgements()).toHaveLength(0);
    });
  });

  describe('MissingRootPromptError propagation', () => {
    it('promptContext.assertHasRootPromptId should throw MissingRootPromptError', () => {
      expect(() => guard.promptContext.assertHasRootPromptId()).toThrow(MissingRootPromptError);
    });

    it('should not throw after setRootPromptId is called on the embedded promptContext', () => {
      guard.promptContext.setRootPromptId('rp-guard-test');
      expect(() => guard.promptContext.assertHasRootPromptId()).not.toThrow();
    });
  });
});
