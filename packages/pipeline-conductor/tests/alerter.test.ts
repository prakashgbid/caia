/**
 * @caia/pipeline-conductor — alerter tests.
 *
 * Verifies:
 *   - subscribes to all three drift event types
 *   - writes INBOX entry on first observation
 *   - deduplicates repeat alerts within the dedup window
 *   - releases the dedup key after the window expires
 *   - writes one dashboard line per non-deduplicated alert
 *   - calls the operator notifier with severity matching event.severity
 *   - notifier errors do not crash the bus
 *   - INBOX_SECTION_HEADER is created on the first write
 *   - renderAlertEntry produces stable text for each event type
 *   - isDriftEventType reflects the canonical list
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { eventBus, type ConductorEvent } from '@chiefaia/event-bus-internal';

import {
  Alerter,
  DRIFT_EVENT_TYPES,
  INBOX_SECTION_HEADER,
  InMemoryAlerterFs,
  isDriftEventType,
  renderAlertEntry,
  type OperatorNotification,
} from '../src/alerter.js';

const FIXED_NOW = new Date('2026-05-25T03:00:00.000Z');
const INBOX_PATH = '/tmp/test-inbox.md';
const DASHBOARD_DIR = '/tmp/test-drift-dashboard';

function makeAlerter(opts: { now?: Date; notifier?: (n: OperatorNotification) => void; dedupWindowMs?: number } = {}): {
  alerter: Alerter;
  fs: InMemoryAlerterFs;
} {
  const fs = new InMemoryAlerterFs();
  const alerter = new Alerter({
    fs,
    clock: () => opts.now ?? FIXED_NOW,
    inboxPath: INBOX_PATH,
    dashboardDir: DASHBOARD_DIR,
    ...(opts.notifier ? { notifier: opts.notifier } : {}),
    ...(opts.dedupWindowMs !== undefined ? { dedupWindowMs: opts.dedupWindowMs } : {}),
  });
  return { alerter, fs };
}

function makePolicyEvent(overrides: Partial<ConductorEvent> = {}): ConductorEvent {
  return {
    id: overrides.id ?? 'ev_test_policy_1',
    type: 'policy.violation.detected',
    occurred_at: FIXED_NOW.toISOString(),
    actor: 'pipeline-conductor',
    severity: 'warning',
    payload: {
      policy_id: 'p005',
      dispatch_id: 'disp-1',
      caller_agent_id: '@caia/decomposer',
      mode: 'soft-fail',
      reason: 'admin merge missing',
    },
    ...overrides,
  } as ConductorEvent;
}

function makeMemoryEvent(overrides: Partial<ConductorEvent> = {}): ConductorEvent {
  return {
    id: overrides.id ?? 'ev_test_memory_1',
    type: 'memory.consistency.broken',
    occurred_at: FIXED_NOW.toISOString(),
    actor: 'pipeline-conductor',
    severity: 'warning',
    payload: {
      memory_file: '/Users/x/agent-memory/feedback.md',
      claim: 'cron loaded',
      actual: 'cron not loaded',
      discovered_by: 'memory-consolidation-cron',
    },
    ...overrides,
  } as ConductorEvent;
}

function makePrincipleEvent(overrides: Partial<ConductorEvent> = {}): ConductorEvent {
  return {
    id: overrides.id ?? 'ev_test_principle_1',
    type: 'architecture.principle.violated',
    occurred_at: FIXED_NOW.toISOString(),
    actor: 'pipeline-conductor',
    severity: 'error',
    payload: {
      principle_id: 'P11',
      adr_id: 'ADR-040',
      location: 'packages/x/src/y.ts:42',
      detected_at: FIXED_NOW.toISOString(),
    },
    ...overrides,
  } as ConductorEvent;
}

describe('Alerter — direct handleDriftEvent', () => {
  it('writes an INBOX entry on first policy violation', async () => {
    const { alerter, fs } = makeAlerter();
    await alerter.handleDriftEvent(makePolicyEvent());
    expect(fs.exists(INBOX_PATH)).toBe(true);
    const body = fs.readFile(INBOX_PATH);
    expect(body).toContain(INBOX_SECTION_HEADER);
    expect(body).toContain('drift: policy.violation.detected');
    expect(body).toContain('p005');
    expect(alerter.inboxEntriesWritten).toBe(1);
  });

  it('writes an INBOX entry on memory inconsistency', async () => {
    const { alerter, fs } = makeAlerter();
    await alerter.handleDriftEvent(makeMemoryEvent());
    const body = fs.readFile(INBOX_PATH);
    expect(body).toContain('drift: memory.consistency.broken');
    expect(body).toContain('cron loaded');
    expect(body).toContain('cron not loaded');
  });

  it('writes an INBOX entry on principle violation', async () => {
    const { alerter, fs } = makeAlerter();
    await alerter.handleDriftEvent(makePrincipleEvent());
    const body = fs.readFile(INBOX_PATH);
    expect(body).toContain('drift: architecture.principle.violated');
    expect(body).toContain('P11');
    expect(body).toContain('ADR-040');
  });

  it('writes a dashboard line in /tmp/test-drift-dashboard', async () => {
    const { alerter, fs } = makeAlerter();
    await alerter.handleDriftEvent(makePolicyEvent());
    const day = FIXED_NOW.toISOString().slice(0, 10);
    const path = `${DASHBOARD_DIR}/drift_dashboard_${day}.md`;
    expect(fs.exists(path)).toBe(true);
    expect(fs.readFile(path)).toContain('policy.violation.detected');
    expect(alerter.dashboardLinesWritten).toBe(1);
  });

  it('deduplicates the same policy event within the dedup window', async () => {
    const { alerter, fs } = makeAlerter();
    await alerter.handleDriftEvent(makePolicyEvent());
    await alerter.handleDriftEvent(makePolicyEvent({ id: 'ev_dup' }));
    expect(alerter.inboxEntriesWritten).toBe(1);
    expect(alerter.inboxEntriesDeduped).toBe(1);
    // Only one entry appears in the body
    const body = fs.readFile(INBOX_PATH);
    const occurrences = (body.match(/drift: policy.violation.detected/g) ?? []).length;
    expect(occurrences).toBe(1);
  });

  it('does NOT dedup distinct policies', async () => {
    const { alerter } = makeAlerter();
    await alerter.handleDriftEvent(makePolicyEvent());
    await alerter.handleDriftEvent(makePolicyEvent({
      id: 'ev_other',
      payload: {
        policy_id: 'p006-different',
        dispatch_id: 'disp-2',
        caller_agent_id: '@caia/other',
        mode: 'soft-fail',
        reason: 'something else',
      },
    }));
    expect(alerter.inboxEntriesWritten).toBe(2);
    expect(alerter.inboxEntriesDeduped).toBe(0);
  });

  it('dedup window expires — second alert is written after window passes', async () => {
    const fs = new InMemoryAlerterFs();
    let now = FIXED_NOW.getTime();
    const alerter = new Alerter({
      fs,
      clock: () => new Date(now),
      inboxPath: INBOX_PATH,
      dashboardDir: DASHBOARD_DIR,
      dedupWindowMs: 1_000,
    });
    await alerter.handleDriftEvent(makePolicyEvent());
    now += 2_000; // advance past the window
    await alerter.handleDriftEvent(makePolicyEvent({ id: 'ev_after_window' }));
    expect(alerter.inboxEntriesWritten).toBe(2);
  });

  it('calls the operator notifier with severity=warning on a warning event', async () => {
    const notified: OperatorNotification[] = [];
    const { alerter } = makeAlerter({ notifier: (n) => { notified.push(n); } });
    await alerter.handleDriftEvent(makePolicyEvent());
    expect(notified).toHaveLength(1);
    expect(notified[0]!.type).toBe('policy.violation.detected');
    expect(notified[0]!.severity).toBe('warning');
    expect(alerter.notifierCalls).toBe(1);
  });

  it('calls the operator notifier with severity=error on a principle violation', async () => {
    const notified: OperatorNotification[] = [];
    const { alerter } = makeAlerter({ notifier: (n) => { notified.push(n); } });
    await alerter.handleDriftEvent(makePrincipleEvent());
    expect(notified[0]!.severity).toBe('error');
  });

  it('notifier exceptions are caught (no throw) and increment notifierErrors', async () => {
    const { alerter } = makeAlerter({
      notifier: () => { throw new Error('notifier-failed'); },
    });
    await expect(alerter.handleDriftEvent(makePolicyEvent())).resolves.toBeUndefined();
    expect(alerter.notifierErrors).toBe(1);
  });

  it('non-drift events are silently ignored', async () => {
    const { alerter, fs } = makeAlerter();
    await alerter.handleDriftEvent({
      ...makePolicyEvent(),
      type: 'pipeline.started' as never,
    });
    expect(fs.exists(INBOX_PATH)).toBe(false);
    expect(alerter.alertsObserved).toBe(0);
  });

  it('resetDedupCache allows re-emit of the same event', async () => {
    const { alerter } = makeAlerter();
    await alerter.handleDriftEvent(makePolicyEvent());
    alerter.resetDedupCache();
    await alerter.handleDriftEvent(makePolicyEvent({ id: 'ev_dup2' }));
    expect(alerter.inboxEntriesWritten).toBe(2);
  });
});

describe('Alerter — bus subscription wiring', () => {
  let unsubGlobal: () => void;
  beforeEach(() => {
    unsubGlobal = (): void => undefined;
  });
  afterEach(() => {
    unsubGlobal();
  });

  it('start() subscribes to all three drift event types', async () => {
    const { alerter, fs } = makeAlerter();
    alerter.start();
    try {
      eventBus.publish({
        type: 'policy.violation.detected' as never,
        actor: 'pipeline-conductor',
        payload: {
          policy_id: 'p', dispatch_id: 'd', caller_agent_id: 'a',
          mode: 'soft-fail', reason: 'r',
        },
      });
      // Give microtasks a chance to flush
      await new Promise((r) => setTimeout(r, 0));
    } finally { alerter.stop(); }
    expect(fs.exists(INBOX_PATH)).toBe(true);
  });

  it('stop() unsubscribes', async () => {
    const { alerter, fs } = makeAlerter();
    alerter.start();
    alerter.stop();
    eventBus.publish({
      type: 'policy.violation.detected' as never,
      actor: 'pipeline-conductor',
      payload: { policy_id: 'p', dispatch_id: 'd', caller_agent_id: 'a', mode: 'soft-fail', reason: 'r' },
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(fs.exists(INBOX_PATH)).toBe(false);
  });
});

describe('Alerter — rendering + helpers', () => {
  it('renderAlertEntry for policy.violation.detected contains policy_id and mode', () => {
    const out = renderAlertEntry('policy.violation.detected', makePolicyEvent(), FIXED_NOW);
    expect(out.inboxMarkdown).toContain('p005');
    expect(out.inboxMarkdown).toContain('soft-fail');
    expect(out.dashboardLine).toContain('policy=p005');
  });

  it('renderAlertEntry for memory.consistency.broken includes claim + actual', () => {
    const out = renderAlertEntry('memory.consistency.broken', makeMemoryEvent(), FIXED_NOW);
    expect(out.inboxMarkdown).toContain('cron loaded');
    expect(out.inboxMarkdown).toContain('cron not loaded');
  });

  it('renderAlertEntry for architecture.principle.violated includes principle + adr', () => {
    const out = renderAlertEntry('architecture.principle.violated', makePrincipleEvent(), FIXED_NOW);
    expect(out.inboxMarkdown).toContain('P11');
    expect(out.inboxMarkdown).toContain('ADR-040');
  });

  it('isDriftEventType returns true for canonical names, false otherwise', () => {
    for (const t of DRIFT_EVENT_TYPES) expect(isDriftEventType(t)).toBe(true);
    expect(isDriftEventType('pipeline.started')).toBe(false);
    expect(isDriftEventType('')).toBe(false);
  });

  it('appendToInbox creates the section header on first write', async () => {
    const { alerter, fs } = makeAlerter();
    await alerter.handleDriftEvent(makePolicyEvent());
    const body = fs.readFile(INBOX_PATH);
    expect(body.indexOf(INBOX_SECTION_HEADER)).toBeGreaterThanOrEqual(0);
  });

  it('appendToInbox inserts under existing section header without duplication', async () => {
    const { alerter, fs } = makeAlerter();
    fs.writeFile(INBOX_PATH, `# INBOX\n\n${INBOX_SECTION_HEADER}\n\n(prior entries)\n`);
    await alerter.handleDriftEvent(makePolicyEvent());
    const body = fs.readFile(INBOX_PATH);
    const headerCount = (body.match(new RegExp(INBOX_SECTION_HEADER, 'g')) ?? []).length;
    expect(headerCount).toBe(1);
    expect(body).toContain('(prior entries)');
    expect(body).toContain('drift: policy.violation.detected');
  });

  it('DRIFT_EVENT_TYPES has length 3 — the canonical Layer 5 trio', () => {
    expect(DRIFT_EVENT_TYPES).toHaveLength(3);
  });

  it('notifier receives the event itself (not a copy without payload)', async () => {
    const seen = vi.fn();
    const { alerter } = makeAlerter({ notifier: (n) => seen(n.event.payload) });
    await alerter.handleDriftEvent(makePolicyEvent());
    expect(seen).toHaveBeenCalledTimes(1);
    expect(seen.mock.calls[0]![0]).toMatchObject({ policy_id: 'p005' });
  });
});
