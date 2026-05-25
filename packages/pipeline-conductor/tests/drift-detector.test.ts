/**
 * @caia/pipeline-conductor — drift-detector tests.
 *
 * Verifies:
 *   - the three direct-API methods emit the canonical event types
 *   - bus subscriptions normalise upstream-shaped signals
 *   - the re-emit guard short-circuits self-emitted events (no loops)
 *   - malformed payloads are rejected without throwing
 *   - severity is dynamic on `policy.violation.detected` based on `mode`
 *   - subscriptions are unsubscribed cleanly on stop()
 *   - causation_id propagates from source events to emitted drift events
 *   - default source globs include the documented alias names
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eventBus, type ConductorEvent } from '@chiefaia/event-bus-internal';

import {
  DriftDetector,
  DEFAULT_SOURCE_GLOBS,
  DRIFT_DETECTOR_ACTOR,
} from '../src/drift-detector.js';

const FIXED_NOW = new Date('2026-05-25T03:00:00.000Z');

let capturedDrift: ConductorEvent[];
let unsubAll: () => void;

function captureDrift(): void {
  capturedDrift = [];
  unsubAll = eventBus.subscribe('*', (e) => {
    if (
      e.type === 'policy.violation.detected' ||
      e.type === 'memory.consistency.broken' ||
      e.type === 'architecture.principle.violated'
    ) capturedDrift.push(e);
  });
}

beforeEach(() => {
  captureDrift();
});

afterEach(() => {
  unsubAll();
});

describe('DriftDetector — direct API', () => {
  it('reportPolicyViolation emits policy.violation.detected with actor=pipeline-conductor', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPolicyViolation({
      policy_id: 'p005-auto-merge-prs',
      dispatch_id: 'disp-42',
      caller_agent_id: '@caia/decomposer',
      mode: 'soft-fail',
      reason: 'PR opened without admin-merge intent',
    });
    expect(capturedDrift).toHaveLength(1);
    expect(capturedDrift[0]!.type).toBe('policy.violation.detected');
    expect(capturedDrift[0]!.actor).toBe(DRIFT_DETECTOR_ACTOR);
    expect(capturedDrift[0]!.payload).toMatchObject({
      policy_id: 'p005-auto-merge-prs',
      caller_agent_id: '@caia/decomposer',
      mode: 'soft-fail',
      reason: 'PR opened without admin-merge intent',
    });
  });

  it('reportPolicyViolation severity is warning on soft-fail', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPolicyViolation({
      policy_id: 'p1', dispatch_id: 'd1', caller_agent_id: 'a',
      mode: 'soft-fail', reason: 'r',
    });
    expect(capturedDrift[0]!.severity).toBe('warning');
  });

  it('reportPolicyViolation severity escalates to error on hard-fail', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPolicyViolation({
      policy_id: 'p1', dispatch_id: 'd1', caller_agent_id: 'a',
      mode: 'hard-fail', reason: 'r',
    });
    expect(capturedDrift[0]!.severity).toBe('error');
  });

  it('reportPolicyViolation includes suggested_fix when provided', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPolicyViolation({
      policy_id: 'p1', dispatch_id: 'd1', caller_agent_id: 'a',
      mode: 'advisory', reason: 'r',
      suggested_fix: 'add --admin to gh pr merge',
    });
    expect((capturedDrift[0]!.payload as Record<string, unknown>).suggested_fix)
      .toBe('add --admin to gh pr merge');
  });

  it('reportMemoryInconsistency emits memory.consistency.broken with severity=warning', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportMemoryInconsistency({
      memory_file: '/Users/x/agent-memory/feedback_X.md',
      claim: 'cron loaded',
      actual: 'cron not loaded',
      discovered_by: 'memory-consolidation-cron',
    });
    expect(capturedDrift).toHaveLength(1);
    expect(capturedDrift[0]!.type).toBe('memory.consistency.broken');
    expect(capturedDrift[0]!.severity).toBe('warning');
    expect(capturedDrift[0]!.actor).toBe(DRIFT_DETECTOR_ACTOR);
  });

  it('reportPrincipleViolation emits architecture.principle.violated with severity=error', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPrincipleViolation({
      principle_id: 'P11',
      adr_id: 'ADR-040',
      location: 'packages/x/src/y.ts:42',
    });
    expect(capturedDrift).toHaveLength(1);
    expect(capturedDrift[0]!.type).toBe('architecture.principle.violated');
    expect(capturedDrift[0]!.severity).toBe('error');
  });

  it('reportPrincipleViolation injects clock-provided detected_at when omitted', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPrincipleViolation({
      principle_id: 'P11', location: 'a:1',
    });
    expect((capturedDrift[0]!.payload as Record<string, unknown>).detected_at)
      .toBe(FIXED_NOW.toISOString());
  });

  it('reportPrincipleViolation preserves explicit detected_at', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPrincipleViolation({
      principle_id: 'P11', location: 'a:1',
      detected_at: '2026-01-01T00:00:00.000Z',
    });
    expect((capturedDrift[0]!.payload as Record<string, unknown>).detected_at)
      .toBe('2026-01-01T00:00:00.000Z');
  });

  it('telemetry counters increment per emission', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPolicyViolation({ policy_id: 'p', dispatch_id: 'd', caller_agent_id: 'a', mode: 'advisory', reason: 'r' });
    d.reportMemoryInconsistency({ memory_file: 'f', claim: 'c', actual: 'a', discovered_by: 'x' });
    d.reportPrincipleViolation({ principle_id: 'P1', location: 'l' });
    expect(d.policyViolationsEmitted).toBe(1);
    expect(d.memoryInconsistenciesEmitted).toBe(1);
    expect(d.principleViolationsEmitted).toBe(1);
  });

  it('propagates correlation_id from input', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPolicyViolation({
      policy_id: 'p', dispatch_id: 'd', caller_agent_id: 'a', mode: 'advisory', reason: 'r',
      correlation_id: 'corr-42',
    });
    expect(capturedDrift[0]!.correlation_id).toBe('corr-42');
  });

  it('passes entity_type=policy and entity_id=policy_id', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.reportPolicyViolation({ policy_id: 'p007', dispatch_id: 'd', caller_agent_id: 'a', mode: 'advisory', reason: 'r' });
    expect(capturedDrift[0]!.entity_type).toBe('policy');
    expect(capturedDrift[0]!.entity_id).toBe('p007');
  });
});

describe('DriftDetector — bus subscriptions', () => {
  it('normalises a policy-linter.violation source event', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    try {
      eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: {
          policy_id: 'p1',
          dispatch_id: 'd1',
          caller: '@caia/x',
          mode: 'soft-fail',
          reason: 'broken',
        },
        entity_type: 'policy',
        entity_id: 'p1',
      });
    } finally { d.stop(); }
    const normalised = capturedDrift.filter((e) => e.type === 'policy.violation.detected');
    expect(normalised).toHaveLength(1);
    expect((normalised[0]!.payload as Record<string, unknown>).caller_agent_id).toBe('@caia/x');
  });

  it('normalises an ea-drift-sentinel.violation.confirmed source event', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    try {
      eventBus.publish({
        type: 'ea-drift-sentinel.violation.confirmed' as never,
        actor: 'system',
        payload: {
          principleId: 'P11',
          location: 'packages/x/src/y.ts:42',
          adrId: 'ADR-040',
        },
      });
    } finally { d.stop(); }
    const normalised = capturedDrift.filter((e) => e.type === 'architecture.principle.violated');
    expect(normalised).toHaveLength(1);
    expect((normalised[0]!.payload as Record<string, unknown>).principle_id).toBe('P11');
    expect((normalised[0]!.payload as Record<string, unknown>).adr_id).toBe('ADR-040');
  });

  it('normalises memory-consolidator.inconsistency-found', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    try {
      eventBus.publish({
        type: 'memory-consolidator.inconsistency-found' as never,
        actor: 'system',
        payload: {
          memory_file: '/tmp/foo.md',
          claim: 'A',
          actual: 'B',
          discovered_by: 'cron',
        },
      });
    } finally { d.stop(); }
    expect(capturedDrift.filter((e) => e.type === 'memory.consistency.broken')).toHaveLength(1);
  });

  it('re-emit guard blocks own emissions (no infinite loop)', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    try {
      // Direct report emits an event with actor=pipeline-conductor; the
      // bus subscription would see it again. The guard must reject it.
      d.reportPolicyViolation({
        policy_id: 'p', dispatch_id: 'd', caller_agent_id: 'a',
        mode: 'advisory', reason: 'r',
      });
    } finally { d.stop(); }
    expect(capturedDrift.filter((e) => e.type === 'policy.violation.detected')).toHaveLength(1);
    expect(d.reemitLoopsBlocked).toBeGreaterThan(0);
  });

  it('malformed payloads are rejected without throwing', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    try {
      eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: { /* empty */ },
      });
    } finally { d.stop(); }
    expect(capturedDrift.filter((e) => e.type === 'policy.violation.detected')).toHaveLength(0);
    expect(d.malformedSourceEvents).toBeGreaterThan(0);
  });

  it('stop() unsubscribes — subsequent publishes are ignored', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    d.stop();
    eventBus.publish({
      type: 'policy-linter.violation' as never,
      actor: 'system',
      payload: { policy_id: 'p', dispatch_id: 'd', mode: 'advisory', reason: 'r' },
    });
    expect(capturedDrift).toHaveLength(0);
  });

  it('start() is idempotent — calling twice does not double-subscribe', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    d.start(); // no-op
    try {
      eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: { policy_id: 'p', dispatch_id: 'd', caller: 'a', mode: 'advisory', reason: 'r' },
      });
    } finally { d.stop(); }
    expect(capturedDrift.filter((e) => e.type === 'policy.violation.detected')).toHaveLength(1);
  });

  it('propagates causation_id when normalising a source event', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    let source: ConductorEvent | null = null;
    try {
      source = eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: { policy_id: 'p', dispatch_id: 'd', caller: 'a', mode: 'advisory', reason: 'r' },
      });
    } finally { d.stop(); }
    const normalised = capturedDrift.filter((e) => e.type === 'policy.violation.detected');
    expect(normalised[0]!.causation_id).toBe(source!.id);
  });

  it('coerces "block" mode synonym to hard-fail', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    try {
      eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: { policy_id: 'p', dispatch_id: 'd', caller: 'a', mode: 'block', reason: 'r' },
      });
    } finally { d.stop(); }
    const normalised = capturedDrift.filter((e) => e.type === 'policy.violation.detected');
    expect((normalised[0]!.payload as Record<string, unknown>).mode).toBe('hard-fail');
    expect(normalised[0]!.severity).toBe('error');
  });

  it('accepts camelCase payload keys (principleId, ruleId, memoryFile)', () => {
    const d = new DriftDetector({ clock: () => FIXED_NOW });
    d.start();
    try {
      eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: { ruleId: 'p1', dispatch_id: 'd', caller: 'a', mode: 'advisory', reason: 'r' },
      });
      eventBus.publish({
        type: 'memory-consolidator.inconsistency-found' as never,
        actor: 'system',
        payload: { memoryFile: '/x', claim: 'c', actual: 'a', discovered_by: 'cron' },
      });
    } finally { d.stop(); }
    expect(capturedDrift.filter((e) => e.type === 'policy.violation.detected')).toHaveLength(1);
    expect(capturedDrift.filter((e) => e.type === 'memory.consistency.broken')).toHaveLength(1);
  });
});

describe('DriftDetector — defaults', () => {
  it('DEFAULT_SOURCE_GLOBS includes the canonical drift event names', () => {
    expect(DEFAULT_SOURCE_GLOBS.policyViolation).toContain('policy.violation.detected');
    expect(DEFAULT_SOURCE_GLOBS.memoryInconsistency).toContain('memory.consistency.broken');
    expect(DEFAULT_SOURCE_GLOBS.principleViolation).toContain('architecture.principle.violated');
  });

  it('DEFAULT_SOURCE_GLOBS includes the documented alias names', () => {
    expect(DEFAULT_SOURCE_GLOBS.policyViolation).toContain('policy-linter.violation');
    expect(DEFAULT_SOURCE_GLOBS.memoryInconsistency).toContain('memory-consolidator.inconsistency-found');
    expect(DEFAULT_SOURCE_GLOBS.principleViolation).toContain('ea-drift-sentinel.violation.confirmed');
  });
});
