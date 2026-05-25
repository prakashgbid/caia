/**
 * @caia/pipeline-conductor — drift detection integration test.
 *
 * The full closed loop:
 *
 *   fake @caia/policy-linter publishes `policy-linter.violation`
 *      → DriftDetector normalises → emits `policy.violation.detected`
 *      → Alerter receives → writes INBOX entry + dashboard line + notifier
 *
 * All in-process. Real `eventBus`. In-memory FS. Demonstrates the
 * subscription-only contract: the detector imports nothing from the
 * linter; the alerter imports nothing from the detector. Loose coupling
 * via the shared bus IS the wiring.
 */

import { describe, expect, it } from 'vitest';
import { eventBus } from '@chiefaia/event-bus-internal';

import { DriftDetector } from '../src/drift-detector.js';
import {
  Alerter,
  INBOX_SECTION_HEADER,
  InMemoryAlerterFs,
  type OperatorNotification,
} from '../src/alerter.js';

describe('Drift detection integration', () => {
  it('fake policy-linter violation → drift event → INBOX entry + dashboard + notifier', async () => {
    const fs = new InMemoryAlerterFs();
    const inboxPath = '/tmp/integ-inbox.md';
    const dashboardDir = '/tmp/integ-drift-dashboard';
    const notified: OperatorNotification[] = [];

    const now = new Date('2026-05-25T03:00:00.000Z');
    const detector = new DriftDetector({ clock: () => now });
    const alerter = new Alerter({
      fs,
      clock: () => now,
      inboxPath,
      dashboardDir,
      notifier: (n) => { notified.push(n); },
    });

    detector.start();
    alerter.start();
    try {
      // 1. Fake @caia/policy-linter publishes its violation event.
      eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: {
          policy_id: 'p005-auto-merge-prs',
          dispatch_id: 'disp-integration-1',
          caller_agent_id: '@caia/decomposer',
          mode: 'hard-fail',
          reason: 'Opened PR without --admin merge intent',
          suggested_fix: 'append --admin to the gh pr merge call',
        },
      });

      // Allow microtasks (notifier is async) to flush.
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      detector.stop();
      alerter.stop();
    }

    // 2. Drift detector emitted exactly one canonical event.
    expect(detector.policyViolationsEmitted).toBe(1);

    // 3. Alerter wrote the INBOX entry under the dedicated section.
    expect(fs.exists(inboxPath)).toBe(true);
    const inboxBody = fs.readFile(inboxPath);
    expect(inboxBody).toContain(INBOX_SECTION_HEADER);
    expect(inboxBody).toContain('drift: policy.violation.detected');
    expect(inboxBody).toContain('p005-auto-merge-prs');
    expect(inboxBody).toContain('hard-fail');
    expect(inboxBody).toContain('append --admin');

    // 4. Alerter wrote the daily dashboard line.
    const dashFile = `${dashboardDir}/drift_dashboard_2026-05-25.md`;
    expect(fs.exists(dashFile)).toBe(true);
    expect(fs.readFile(dashFile)).toContain('policy.violation.detected');
    expect(fs.readFile(dashFile)).toContain('mode=hard-fail');

    // 5. Notifier invoked with severity=error (because mode=hard-fail).
    expect(notified).toHaveLength(1);
    expect(notified[0]!.severity).toBe('error');
    expect(notified[0]!.type).toBe('policy.violation.detected');

    // 6. Re-emit guard kept us from looping (the detector saw its own
    //    emission via the bus subscription and rejected it).
    expect(detector.reemitLoopsBlocked).toBeGreaterThan(0);
  });

  it('end-to-end with the documented three sources fires three INBOX entries', async () => {
    const fs = new InMemoryAlerterFs();
    const inboxPath = '/tmp/integ-inbox-3.md';
    const dashboardDir = '/tmp/integ-drift-dashboard-3';
    const now = new Date('2026-05-25T03:00:00.000Z');

    const detector = new DriftDetector({ clock: () => now });
    const alerter = new Alerter({
      fs, clock: () => now, inboxPath, dashboardDir,
    });
    detector.start();
    alerter.start();
    try {
      eventBus.publish({
        type: 'policy-linter.violation' as never,
        actor: 'system',
        payload: {
          policy_id: 'p1', dispatch_id: 'd1', caller_agent_id: 'a',
          mode: 'soft-fail', reason: 'r1',
        },
      });
      eventBus.publish({
        type: 'memory-consolidator.inconsistency-found' as never,
        actor: 'system',
        payload: {
          memory_file: '/tmp/feedback.md',
          claim: 'cron loaded',
          actual: 'cron not loaded',
          discovered_by: 'memory-consolidation-cron',
        },
      });
      eventBus.publish({
        type: 'ea-drift-sentinel.violation.confirmed' as never,
        actor: 'system',
        payload: {
          principleId: 'P14',
          location: 'packages/x/src/y.ts:42',
          adrId: 'ADR-061',
        },
      });
      await new Promise((r) => setTimeout(r, 0));
    } finally {
      detector.stop();
      alerter.stop();
    }

    expect(detector.policyViolationsEmitted).toBe(1);
    expect(detector.memoryInconsistenciesEmitted).toBe(1);
    expect(detector.principleViolationsEmitted).toBe(1);

    const body = fs.readFile(inboxPath);
    expect(body).toContain('drift: policy.violation.detected');
    expect(body).toContain('drift: memory.consistency.broken');
    expect(body).toContain('drift: architecture.principle.violated');
    expect(alerter.inboxEntriesWritten).toBe(3);
  });
});
