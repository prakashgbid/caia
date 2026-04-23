/**
 * Integration-level tests for createOrchestrationGuard factory.
 */

import { createOrchestrationGuard } from '../src/index.js';
import { BannedPhraseError } from '../src/errors.js';

describe('createOrchestrationGuard', () => {
  it('returns an object with all expected members', () => {
    const guard = createOrchestrationGuard();
    expect(guard.promptContext).toBeDefined();
    expect(guard.taskRunLogger).toBeDefined();
    expect(typeof guard.scanMessage).toBe('function');
    expect(typeof guard.assertMessageClean).toBe('function');
    expect(typeof guard.getAllViolations).toBe('function');
    expect(typeof guard.reset).toBe('function');
  });

  it('scanMessage returns clean:true for a valid message', () => {
    const guard = createOrchestrationGuard();
    const result = guard.scanMessage('Deployment succeeded on all nodes.');
    expect(result.clean).toBe(true);
  });

  it('scanMessage returns clean:false for a banned phrase', () => {
    const guard = createOrchestrationGuard();
    const result = guard.scanMessage('Shall I continue?');
    expect(result.clean).toBe(false);
  });

  it('assertMessageClean throws BannedPhraseError for a dirty message', () => {
    const guard = createOrchestrationGuard();
    expect(() => guard.assertMessageClean('Should I run the tests?')).toThrow(BannedPhraseError);
  });

  it('getAllViolations merges violations from both sub-components', async () => {
    const guard = createOrchestrationGuard(30_000);
    // Trigger TRACE-001
    try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }
    // Trigger TASK-001 via manual TTL injection
    let fakeNow = Date.now();
    guard.taskRunLogger.setNow(() => fakeNow);
    guard.taskRunLogger.notifySpawned('sess-ttl', 'task');
    fakeNow += 31_000;
    // getAllViolations internally calls checkTtlViolations
    const violations = guard.getAllViolations();
    const ruleIds = violations.map(v => v.ruleId);
    expect(ruleIds).toContain('TRACE-001');
    expect(ruleIds).toContain('TASK-001');
  });

  it('getAllViolations returns violations sorted by timestamp ascending', async () => {
    const guard = createOrchestrationGuard();
    try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }
    await new Promise(r => setTimeout(r, 2)); // ensure different ms timestamps
    try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }
    const violations = guard.getAllViolations();
    for (let i = 1; i < violations.length; i++) {
      expect(violations[i]!.timestamp >= violations[i - 1]!.timestamp).toBe(true);
    }
  });

  it('reset clears all state across sub-components', () => {
    const guard = createOrchestrationGuard();
    try { guard.promptContext.assertHasRootPromptId(); } catch { /* expected */ }
    guard.taskRunLogger.notifySpawned('sess-1', 'code');
    guard.reset();
    expect(guard.getAllViolations()).toHaveLength(0);
    expect(guard.taskRunLogger.getPendingAcknowledgements()).toHaveLength(0);
    expect(guard.promptContext.getRootPromptId()).toBeUndefined();
  });
});
