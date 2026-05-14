// H-10 (chain-runner-battle-harden phase 5, 2026-05-14) — alerting backbone
// tests. Specifically validates fingerprint dedupe across all four channels,
// since "broken dedupe = pager storm" was called out as the #1 risk in the
// hardening plan. osascript invocations are stubbed via opts.spawn to avoid
// firing real notifications during test runs.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  DEFAULT_CHANNELS_BY_TYPE,
  emitAlert,
  fingerprintForAlert,
  resolveChannels,
  type AlertEvent,
  type AlertChannel,
} from '../src/alerting.js';

function makeAlertEnv() {
  const root = mkdtempSync(join(tmpdir(), 'caia-alert-'));
  return {
    root,
    inboxPath: join(root, 'INBOX.md'),
    alertsJsonlPath: join(root, 'active_alerts.jsonl'),
    dedupePath: join(root, 'dedupe.json'),
    auditFile: join(root, 'audit.jsonl'),
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

function baseEvent(over: Partial<AlertEvent> = {}): AlertEvent {
  return {
    type: 'chain_stalled',
    severity: 'high',
    title: 't',
    detail: 'd',
    chain: 'test-chain',
    ...over,
  };
}

describe('fingerprintForAlert', () => {
  it('produces a deterministic short hash for (chain, type, day)', () => {
    const now = () => new Date('2026-05-14T12:00:00Z');
    const a = fingerprintForAlert(baseEvent(), now);
    const b = fingerprintForAlert(baseEvent(), now);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('differs by chain', () => {
    const now = () => new Date('2026-05-14T12:00:00Z');
    const a = fingerprintForAlert(baseEvent({ chain: 'A' }), now);
    const b = fingerprintForAlert(baseEvent({ chain: 'B' }), now);
    expect(a).not.toBe(b);
  });

  it('differs by type', () => {
    const now = () => new Date('2026-05-14T12:00:00Z');
    const a = fingerprintForAlert(baseEvent({ type: 'chain_stalled' }), now);
    const b = fingerprintForAlert(baseEvent({ type: 'chain_rate_limited' }), now);
    expect(a).not.toBe(b);
  });

  it('differs by day', () => {
    const a = fingerprintForAlert(baseEvent({ fingerprintDay: '2026-05-14' }));
    const b = fingerprintForAlert(baseEvent({ fingerprintDay: '2026-05-15' }));
    expect(a).not.toBe(b);
  });
});

describe('resolveChannels', () => {
  it('honors per-event channels first', () => {
    const ev = baseEvent({ channels: ['audit'] });
    expect(resolveChannels(ev, ['handoff', 'inbox', 'notification'])).toEqual(['audit']);
  });

  it('falls back to configChannels (chain_config.alert_channels)', () => {
    const ev = baseEvent();
    expect(resolveChannels(ev, ['audit', 'inbox'])).toEqual(['audit', 'inbox']);
  });

  it('falls back to defaults-by-type when neither is given', () => {
    const ev = baseEvent({ type: 'chain_stalled' });
    expect(resolveChannels(ev)).toEqual(DEFAULT_CHANNELS_BY_TYPE['chain_stalled']);
  });

  it('filters unknown channel names from configChannels', () => {
    const ev = baseEvent({ type: 'chain_stalled' });
    const out = resolveChannels(ev, ['handoff', 'sms', 'pagerduty']);
    expect(out).toEqual(['handoff']);
  });

  it('default for unknown event types is [inbox,audit]', () => {
    const ev = baseEvent({ type: 'made_up_type' });
    expect(resolveChannels(ev)).toEqual(['inbox', 'audit']);
  });
});

describe('emitAlert — channel fan-out', () => {
  let env: ReturnType<typeof makeAlertEnv>;
  beforeEach(() => {
    env = makeAlertEnv();
  });
  afterEach(() => env.cleanup());

  it('writes to handoff JSONL, inbox markdown, audit jsonl, and notification (stubbed)', () => {
    const notifs: string[][] = [];
    const r = emitAlert(['handoff', 'inbox', 'notification', 'audit'], baseEvent(), {
      auditFile: env.auditFile,
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      spawn: (cmd, args) => {
        notifs.push([cmd, ...args]);
        return { status: 0 };
      },
    });
    expect(r.fired.sort()).toEqual(['audit', 'handoff', 'inbox', 'notification']);
    expect(r.deduped).toBe(false);

    // Handoff JSONL — exactly one line, parses as JSON
    const handoffBody = readFileSync(env.alertsJsonlPath, 'utf8').trim();
    const lines = handoffBody.split('\n');
    expect(lines).toHaveLength(1);
    const rec = JSON.parse(lines[0]!);
    expect(rec.type).toBe('chain_stalled');
    expect(rec.chain).toBe('test-chain');
    expect(rec.fingerprint).toMatch(/^[0-9a-f]{16}$/);

    // Inbox markdown
    const inbox = readFileSync(env.inboxPath, 'utf8');
    expect(inbox).toContain('## ');
    expect(inbox).toContain('chain_stalled — test-chain');
    expect(inbox).toContain('fingerprint:');

    // Audit
    const audit = readFileSync(env.auditFile, 'utf8');
    expect(audit).toContain('"event":"alert_emitted"');
    expect(audit).toContain('"type":"chain_stalled"');
    expect(audit).toContain('"fingerprint":');

    // Notification — osascript called once with -e
    expect(notifs).toHaveLength(1);
    expect(notifs[0]![0]).toBe('osascript');
    expect(notifs[0]![1]).toBe('-e');
  });

  it('audit channel is suppressed when auditFile is omitted', () => {
    const r = emitAlert(['audit', 'inbox'], baseEvent(), {
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
    });
    expect(r.fired).toContain('inbox');
    expect(r.fired).not.toContain('audit');
    expect(r.suppressed).toContain('audit');
    expect(existsSync(env.auditFile)).toBe(false);
  });

  it('notification channel is suppressed when notificationsEnabled=false', () => {
    let called = 0;
    const r = emitAlert(['notification'], baseEvent(), {
      auditFile: env.auditFile,
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      notificationsEnabled: false,
      spawn: () => {
        called += 1;
        return { status: 0 };
      },
    });
    expect(r.fired).not.toContain('notification');
    expect(r.suppressed).toContain('notification');
    expect(called).toBe(0);
  });

  it('throws when event.chain is missing', () => {
    expect(() =>
      emitAlert(['inbox'], { ...baseEvent(), chain: '' } as AlertEvent, {
        inboxPath: env.inboxPath,
        alertsJsonlPath: env.alertsJsonlPath,
        dedupePath: env.dedupePath,
      }),
    ).toThrow(/event\.chain/);
  });
});

describe('emitAlert — fingerprint dedupe', () => {
  let env: ReturnType<typeof makeAlertEnv>;
  beforeEach(() => {
    env = makeAlertEnv();
  });
  afterEach(() => env.cleanup());

  it('suppresses identical (chain, type, day) within the 6h window — INCLUDING notification', () => {
    let notifs = 0;
    const spawn = (_cmd: string, _args: string[]) => {
      notifs += 1;
      return { status: 0 };
    };
    const channels: AlertChannel[] = ['handoff', 'inbox', 'notification', 'audit'];
    const ev = baseEvent();
    const opts = {
      auditFile: env.auditFile,
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      spawn,
    };

    const r1 = emitAlert(channels, ev, opts);
    const r2 = emitAlert(channels, ev, opts);
    const r3 = emitAlert(channels, ev, opts);

    expect(r1.fired.length).toBe(4);
    expect(r2.deduped).toBe(true);
    expect(r2.fired).toEqual([]);
    expect(r3.deduped).toBe(true);
    expect(r3.fired).toEqual([]);

    // CRITICAL: osascript invoked exactly ONCE across three emits.
    expect(notifs).toBe(1);

    // Handoff JSONL has exactly one record
    const lines = readFileSync(env.alertsJsonlPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);

    // Inbox has exactly one block (heading appears once)
    const inbox = readFileSync(env.inboxPath, 'utf8');
    expect(inbox.match(/cron_stall_detected|chain_stalled/g)?.length ?? 0).toBe(1);

    // Audit: 1 emitted + 2 suppressed
    const audit = readFileSync(env.auditFile, 'utf8').trim().split('\n');
    const emitted = audit.filter((l) => l.includes('"event":"alert_emitted"'));
    const suppressed = audit.filter((l) => l.includes('"event":"alert_suppressed_duplicate"'));
    expect(emitted).toHaveLength(1);
    expect(suppressed).toHaveLength(2);
  });

  it('re-fires after the dedupe window elapses', () => {
    const ev = baseEvent();
    const opts = {
      auditFile: env.auditFile,
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      notificationsEnabled: false,
      dedupeWindowSec: 3600,
    };
    const r1 = emitAlert(['inbox', 'audit'], ev, {
      ...opts,
      now: () => new Date('2026-05-14T10:00:00Z'),
    });
    expect(r1.fired.length).toBe(2);
    const r2 = emitAlert(['inbox', 'audit'], ev, {
      ...opts,
      now: () => new Date('2026-05-14T11:30:00Z'), // > 1h later
    });
    expect(r2.deduped).toBe(false);
    expect(r2.fired.length).toBe(2);
  });

  it('force=true bypasses dedupe even within window', () => {
    let notifs = 0;
    const ev = baseEvent();
    const opts = {
      auditFile: env.auditFile,
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      spawn: () => {
        notifs += 1;
        return { status: 0 };
      },
    };
    emitAlert(['notification'], ev, opts);
    const r2 = emitAlert(['notification'], { ...ev, force: true }, opts);
    expect(r2.deduped).toBe(false);
    expect(r2.fired).toContain('notification');
    expect(notifs).toBe(2);
  });

  it('different types share the dedupe window-by-type, not collide', () => {
    const opts = {
      auditFile: env.auditFile,
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      notificationsEnabled: false,
    };
    const a = emitAlert(['inbox'], baseEvent({ type: 'chain_stalled' }), opts);
    const b = emitAlert(['inbox'], baseEvent({ type: 'chain_rate_limited' }), opts);
    expect(a.fired).toContain('inbox');
    expect(b.fired).toContain('inbox');
    expect(a.fingerprint).not.toBe(b.fingerprint);
  });

  it('does not record dedupe when ALL channels were suppressed (recovers next time)', () => {
    // emit with only the 'audit' channel but no auditFile → audit suppressed,
    // no other channels fire → dedupe should NOT be locked in.
    const opts = {
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      notificationsEnabled: false,
    };
    const r1 = emitAlert(['audit'], baseEvent(), opts);
    expect(r1.fired).toEqual([]);
    expect(r1.suppressed).toEqual(['audit']);
    expect(existsSync(env.dedupePath)).toBe(false);

    // Next call with the inbox channel must NOT be deduped — the prior call
    // didn't earn a dedupe entry because nothing fired.
    const r2 = emitAlert(['inbox'], baseEvent(), opts);
    expect(r2.deduped).toBe(false);
    expect(r2.fired).toContain('inbox');
  });

  it('survives a corrupt dedupe file (treats as empty)', () => {
    writeFileSync(env.dedupePath, '{not valid json');
    const r = emitAlert(['inbox'], baseEvent(), {
      inboxPath: env.inboxPath,
      alertsJsonlPath: env.alertsJsonlPath,
      dedupePath: env.dedupePath,
      notificationsEnabled: false,
    });
    expect(r.fired).toContain('inbox');
    // After successful emit, dedupe file is replaced with a valid one.
    const parsed = JSON.parse(readFileSync(env.dedupePath, 'utf8'));
    expect(parsed.fingerprints).toBeDefined();
  });
});
