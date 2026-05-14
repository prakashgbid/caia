// H-11 (chain-runner-battle-harden phase 8, 2026-05-14). Per-phase
// configurable heartbeat grace. Cases verify the resolution order
//   phase override → chain default → DEFAULT_HEARTBEAT_GRACE_SEC (1800s).
//
// Each case acquires a lock, backdates its heartbeat by a chosen number of
// seconds, and asserts that checkLockStaleness either fires staleness or
// keeps the lock live based on the effective grace for that phase.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  buildInitialState,
  DEFAULT_HEARTBEAT_GRACE_SEC,
  loadContext,
  markInProgress,
  type StateContext,
} from '../src/state.js';
import {
  acquireLock,
  checkLockStaleness,
  loadLock,
  saveLock,
} from '../src/lock.js';
import type { LockFile } from '../src/types.js';

interface MiniFixture {
  ctx: StateContext;
  cleanup: () => void;
}

function makeSpecFixture(specYaml: string): MiniFixture {
  const root = mkdtempSync(join(tmpdir(), `caia-hb-cfg-`));
  const chainHome = join(root, 'chain');
  mkdirSync(chainHome, { recursive: true });
  const specPath = join(root, 'phases.yaml');
  writeFileSync(specPath, specYaml);
  process.env['CAIA_CHAIN_HOME'] = chainHome;
  process.env['CAIA_ALERT_INBOX_PATH'] = join(root, 'INBOX.md');
  process.env['CAIA_ALERT_HANDOFF_JSONL_PATH'] = join(root, 'active_alerts.jsonl');
  process.env['CAIA_ALERT_DEDUPE_PATH'] = join(root, '.alert-dedupe.json');
  process.env['CAIA_DISABLE_NOTIFICATIONS'] = '1';
  const chainId = `hb-cfg-${process.pid}-${Math.random().toString(36).slice(2, 8)}`;
  const ctx = loadContext(chainId, specPath);
  return {
    ctx,
    cleanup: () => {
      delete process.env['CAIA_CHAIN_HOME'];
      delete process.env['CAIA_ALERT_INBOX_PATH'];
      delete process.env['CAIA_ALERT_HANDOFF_JSONL_PATH'];
      delete process.env['CAIA_ALERT_DEDUPE_PATH'];
      delete process.env['CAIA_DISABLE_NOTIFICATIONS'];
    },
  };
}

function isoSecondsAgo(sec: number): string {
  return new Date(Date.now() - sec * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, 'Z');
}

let fx: MiniFixture | null = null;
afterEach(() => {
  fx?.cleanup();
  fx = null;
});

describe('H-11 per-phase heartbeat_grace_sec', () => {
  // Case 1: default (no phase override, no chain default) → 1800s.
  // Heartbeat backdated 2000s → exceeds 1800s default → staleness fires.
  it('case 1: no override → DEFAULT_HEARTBEAT_GRACE_SEC=1800; 2000s-old hb is stale', () => {
    fx = makeSpecFixture(`defaults:
  max_minutes: 60
phases:
  - id: 1
    name: phase_default
    deps: []
    prompt_template: |
      x
`);
    const { ctx } = fx;
    // Sanity-check buildInitialState wrote the resolved grace.
    const initial = buildInitialState(ctx.spec);
    expect(initial.phase_status['1']?.heartbeat_grace_sec).toBe(
      DEFAULT_HEARTBEAT_GRACE_SEC,
    );
    markInProgress(ctx, '1', 'sess-c1');
    acquireLock(ctx, 1, 'sess-c1');
    const lock = loadLock(ctx) as LockFile;
    saveLock(ctx, { ...lock, heartbeat: isoSecondsAgo(2000) });
    const r = checkLockStaleness(ctx);
    expect(r.kind).toBe('cleared');
    if (r.kind === 'cleared') expect(r.reason).toBe('heartbeat');
  });

  // Case 2: per-phase override of 4h (14400s). A 90-min-old heartbeat is
  // stale under the old 3600s default and the new 1800s default — but the
  // override widens the grace, so the lock must remain live. This is the
  // legit-slow-phase scenario (e.g. a long bake / training step).
  it('case 2: phase override widens grace → 90-min-old hb stays live', () => {
    fx = makeSpecFixture(`defaults:
  max_minutes: 600
phases:
  - id: 1
    name: phase_slow
    deps: []
    heartbeat_grace_sec: 14400
    prompt_template: |
      x
`);
    const { ctx } = fx;
    const initial = buildInitialState(ctx.spec);
    expect(initial.phase_status['1']?.heartbeat_grace_sec).toBe(14400);
    markInProgress(ctx, '1', 'sess-c2');
    acquireLock(ctx, 1, 'sess-c2');
    const lock = loadLock(ctx) as LockFile;
    saveLock(ctx, { ...lock, heartbeat: isoSecondsAgo(90 * 60) });
    const r = checkLockStaleness(ctx);
    expect(r.kind).toBe('live');
  });

  // Case 3: chain default 900s; a 1000s-old heartbeat trips it. Proves the
  // chain default applies when the phase has no override.
  it('case 3: chain default 900s narrows grace → 1000s-old hb fires staleness', () => {
    fx = makeSpecFixture(`defaults:
  max_minutes: 60
  heartbeat_grace_sec: 900
phases:
  - id: 1
    name: phase_tight
    deps: []
    prompt_template: |
      x
`);
    const { ctx } = fx;
    const initial = buildInitialState(ctx.spec);
    expect(initial.phase_status['1']?.heartbeat_grace_sec).toBe(900);
    markInProgress(ctx, '1', 'sess-c3');
    acquireLock(ctx, 1, 'sess-c3');
    const lock = loadLock(ctx) as LockFile;
    saveLock(ctx, { ...lock, heartbeat: isoSecondsAgo(1000) });
    const r = checkLockStaleness(ctx);
    expect(r.kind).toBe('cleared');
    if (r.kind === 'cleared') expect(r.reason).toBe('heartbeat');
  });

  // Case 4: phase override beats chain default. Chain default is 600s,
  // phase widens to 7200s, and a 30-min-old heartbeat stays live.
  it('case 4: phase override beats chain default — phase wins', () => {
    fx = makeSpecFixture(`defaults:
  max_minutes: 600
  heartbeat_grace_sec: 600
phases:
  - id: 1
    name: phase_overrides
    deps: []
    heartbeat_grace_sec: 7200
    prompt_template: |
      x
`);
    const { ctx } = fx;
    const initial = buildInitialState(ctx.spec);
    expect(initial.phase_status['1']?.heartbeat_grace_sec).toBe(7200);
    markInProgress(ctx, '1', 'sess-c4');
    acquireLock(ctx, 1, 'sess-c4');
    const lock = loadLock(ctx) as LockFile;
    saveLock(ctx, { ...lock, heartbeat: isoSecondsAgo(30 * 60) });
    const r = checkLockStaleness(ctx);
    expect(r.kind).toBe('live');
  });
});
