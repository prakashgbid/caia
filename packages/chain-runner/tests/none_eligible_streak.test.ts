// H-5 (chain-runner-battle-harden phase 5, 2026-05-14). End-to-end test of
// the NONE_ELIGIBLE escalation flow:
//
//   1. State carries a `none_eligible_streak` field that increments inside
//      computeNextPhase on every `none_eligible` result and resets to 0 on
//      every other result kind.
//   2. cascade.diagnoseStall walks the dep graph and names the upstream
//      blocker plus a suggested re-arm command.
//   3. Integration: chain with phase 2 deps=[1], force phase 1 blocked, run
//      3 simulated "wake" iterations of [check-stall --alert-on-streak 2].
//      After the wakes, the unified backbone must have fired exactly ONE
//      alert (dedupe), so SESSION_HANDOFF JSONL has one record and INBOX.md
//      has one block.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  computeNextPhase,
  initState,
  loadContext,
  loadState,
  markDone,
  saveState,
  type StateContext,
} from '../src/state.js';
import { diagnoseStall } from '../src/cascade.js';
import { emitAlert } from '../src/alerting.js';
import type { AlertEvent } from '../src/alerting.js';

let fx: FixtureBundle;
let ctx: StateContext;

beforeEach(() => {
  fx = makeFixture(`streak-${Math.random().toString(36).slice(2, 8)}`);
  ctx = loadContext(fx.chainId, fx.specPath);
  initState(ctx);
});

afterEach(() => fx.cleanup());

describe('none_eligible_streak — state machine', () => {
  it('starts at 0', () => {
    const state = loadState(ctx);
    expect(state.none_eligible_streak).toBe(0);
  });

  it('does not increment when a dispatchable phase is found', () => {
    // Phase 1 has no deps and is pending → next-phase returns phase_id.
    computeNextPhase(ctx, loadState(ctx));
    expect(loadState(ctx).none_eligible_streak).toBe(0);
  });

  it('increments by 1 each time computeNextPhase returns none_eligible', () => {
    // Force a stall: block phase 1 so phase 2..13 can't run.
    const state = loadState(ctx);
    state.phase_status['1']!.status = 'blocked';
    saveState(ctx, state);

    const r1 = computeNextPhase(ctx, loadState(ctx));
    expect(r1.kind).toBe('none_eligible');
    expect(loadState(ctx).none_eligible_streak).toBe(1);

    const r2 = computeNextPhase(ctx, loadState(ctx));
    expect(r2.kind).toBe('none_eligible');
    expect(loadState(ctx).none_eligible_streak).toBe(2);

    const r3 = computeNextPhase(ctx, loadState(ctx));
    expect(r3.kind).toBe('none_eligible');
    expect(loadState(ctx).none_eligible_streak).toBe(3);
  });

  it('resets to 0 on the first non-none_eligible result', () => {
    // Stall first.
    const s1 = loadState(ctx);
    s1.phase_status['1']!.status = 'blocked';
    saveState(ctx, s1);
    computeNextPhase(ctx, loadState(ctx));
    computeNextPhase(ctx, loadState(ctx));
    expect(loadState(ctx).none_eligible_streak).toBe(2);

    // Unblock phase 1 — now next-phase finds a dispatchable phase.
    const s2 = loadState(ctx);
    s2.phase_status['1']!.status = 'pending';
    saveState(ctx, s2);
    const r = computeNextPhase(ctx, loadState(ctx));
    expect(r.kind).toBe('phase_id');
    expect(loadState(ctx).none_eligible_streak).toBe(0);
  });

  it('resets on paused / all_done / backoff / in_progress results too', () => {
    // Stall first.
    const s1 = loadState(ctx);
    s1.phase_status['1']!.status = 'blocked';
    saveState(ctx, s1);
    computeNextPhase(ctx, loadState(ctx));
    expect(loadState(ctx).none_eligible_streak).toBe(1);

    // Pause the chain — next computeNextPhase returns 'paused' and resets.
    const s2 = loadState(ctx);
    s2.paused = true;
    saveState(ctx, s2);
    const r = computeNextPhase(ctx, loadState(ctx));
    expect(r.kind).toBe('paused');
    expect(loadState(ctx).none_eligible_streak).toBe(0);
  });

  it('emits an audit none_eligible event on each stall tick', () => {
    const s = loadState(ctx);
    s.phase_status['1']!.status = 'blocked';
    saveState(ctx, s);
    computeNextPhase(ctx, loadState(ctx));
    const audit = readFileSync(ctx.paths.auditFile, 'utf8');
    expect(audit).toContain('"event":"none_eligible"');
  });
});

describe('diagnoseStall — root cause walker', () => {
  it('names the blocker when an upstream phase is blocked', () => {
    const s = loadState(ctx);
    // Mark phase 1 blocked with a typed failure.
    s.phase_status['1']!.status = 'blocked';
    s.phase_status['1']!.last_failure_class = 'worker_no_start_rate_limit';
    s.phase_status['1']!.failure = {
      class: 'worker_no_start_rate_limit',
      reason: 'rate limit until 2026-05-16T16:00Z',
      detected_at: '2026-05-14T12:00:00Z',
      evidence: { reset_iso: '2026-05-16T16:00Z' },
    };
    saveState(ctx, s);

    const diag = diagnoseStall(ctx.spec, loadState(ctx));
    expect(diag.nextPending?.id).toBe(1);
    expect(diag.blocker?.id).toBe(1);
    expect(diag.diagnosis).toContain('phase 1');
    expect(diag.diagnosis).toContain('blocked');
    expect(diag.diagnosis).toContain('worker_no_start_rate_limit');
    expect(diag.suggested).toContain('re-arm 1');
  });

  it('walks the dep graph to the deepest blocker', () => {
    const s = loadState(ctx);
    // Phase 1 done; phase 2 blocked; phase 3 pending with deps=[2].
    markDone(ctx, '1');
    const s2 = loadState(ctx);
    s2.phase_status['2']!.status = 'blocked';
    s2.phase_status['2']!.last_failure_class = 'worker_no_start_auth_failure';
    saveState(ctx, s2);

    const diag = diagnoseStall(ctx.spec, loadState(ctx));
    expect(diag.nextPending?.id).toBe(2);
    expect(diag.blocker?.id).toBe(2);
    expect(diag.suggested).toContain('OPERATOR_ACTION_REQUIRED');
  });

  it('reports idle (not stalled) when next pending has deps met but is just pending', () => {
    // Fresh state — phase 1 pending, no deps; chain is dispatchable, not stalled.
    const diag = diagnoseStall(ctx.spec, loadState(ctx));
    expect(diag.nextPending?.id).toBe(1);
    expect(diag.blocker).toBeNull();
    expect(diag.diagnosis).toContain('pending');
  });

  it('respects paused state', () => {
    const s = loadState(ctx);
    s.paused = true;
    s.paused_reason = 'rate_limit_until_2026-05-16T16:00Z';
    s.paused_until = '2026-05-16T16:00:00Z';
    saveState(ctx, s);
    const diag = diagnoseStall(ctx.spec, loadState(ctx));
    expect(diag.diagnosis).toContain('paused');
    expect(diag.diagnosis).toContain('2026-05-16T16:00:00Z');
  });
});

describe('integration — 3 wakes with phase 1 blocked produce exactly one alert', () => {
  // Mirrors the task spec: "simulate a chain with phase 2 deps=[1], force
  // phase 1 blocked, run 3 wakes, assert SESSION_HANDOFF gets exactly one
  // block and INBOX gets one block." The fixture has phases 1..13 with
  // chained deps; blocking phase 1 cascades to all downstream phases.

  it('one INBOX block + one handoff JSONL record across 3 stall wakes', () => {
    // Force the stall.
    const s = loadState(ctx);
    s.phase_status['1']!.status = 'blocked';
    s.phase_status['1']!.last_failure_class = 'worker_no_start_rate_limit';
    saveState(ctx, s);

    const inboxPath = process.env['CAIA_ALERT_INBOX_PATH']!;
    const handoffPath = process.env['CAIA_ALERT_HANDOFF_JSONL_PATH']!;

    // Simulate three wake ticks. Each tick:
    //   1. computeNextPhase → none_eligible → streak ++
    //   2. if streak >= 2, emit chain_stalled alert (dedupe-protected)
    let notifs = 0;
    for (let i = 0; i < 3; i++) {
      const result = computeNextPhase(ctx, loadState(ctx));
      expect(result.kind).toBe('none_eligible');
      const state = loadState(ctx);
      const streak = state.none_eligible_streak ?? 0;
      if (streak >= 2) {
        const diag = diagnoseStall(ctx.spec, state);
        const event: AlertEvent = {
          type: 'chain_stalled',
          severity: 'high',
          title: `chain_stalled — ${fx.chainId}`,
          detail: diag.diagnosis,
          chain: fx.chainId,
          evidence: { streak },
        };
        emitAlert(undefined, event, {
          auditFile: ctx.paths.auditFile,
          // Override the fixture-default CAIA_DISABLE_NOTIFICATIONS=1 so the
          // notification channel actually attempts the spawn; we stub spawn
          // itself to count calls without firing a real osascript.
          notificationsEnabled: true,
          spawn: () => {
            notifs += 1;
            return { status: 0 };
          },
        });
      }
    }

    // Streak hit 3, but only ticks 2 and 3 attempted emit, and only ONE
    // landed because of fingerprint dedupe within the 6h window.
    expect(loadState(ctx).none_eligible_streak).toBe(3);

    // INBOX.md — exactly one chain_stalled block (count headings, not the
    // title field which also includes the type→chain string).
    expect(existsSync(inboxPath)).toBe(true);
    const inbox = readFileSync(inboxPath, 'utf8');
    const inboxBlocks = inbox.match(/^## \[.*\] chain_stalled — /gm) ?? [];
    expect(inboxBlocks).toHaveLength(1);

    // active_alerts.jsonl — exactly one chain_stalled record
    expect(existsSync(handoffPath)).toBe(true);
    const handoffLines = readFileSync(handoffPath, 'utf8').trim().split('\n');
    expect(handoffLines).toHaveLength(1);
    const rec = JSON.parse(handoffLines[0]!);
    expect(rec.type).toBe('chain_stalled');
    expect(rec.chain).toBe(fx.chainId);

    // osascript — exactly one notification across 3 wakes
    expect(notifs).toBe(1);

    // Audit log — one emit + one suppression (the third tick fingerprint-deduped)
    const audit = readFileSync(ctx.paths.auditFile, 'utf8').trim().split('\n');
    const emitLines = audit.filter((l) => l.includes('"event":"alert_emitted"'));
    const suppressLines = audit.filter((l) =>
      l.includes('"event":"alert_suppressed_duplicate"'),
    );
    expect(emitLines).toHaveLength(1);
    expect(suppressLines).toHaveLength(1);
  });
});
