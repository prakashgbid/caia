// Golden-output tests for `caia-chain mark-done --adoption-pending-ok --reason
// <text>` — the audit-only override side of DoD v2 Guardrail #10 (phase 2 of
// the adoption gate, 2026-05-16).
//
// The shell wrapper scripts/gate-mark-done.sh is the enforcement chokepoint
// (its golden behavior is covered by the bash CLI in caia-adopt-cli.test.ts).
// This file covers the override path that runs INSTEAD of (i.e. bypassing)
// the shell wrapper: a worker that consciously skipped gate-mark-done.sh and
// is recording why in the chain audit log.

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeFixture, type FixtureBundle } from './fixtures.js';
import {
  acquireLock,
} from '../src/lock.js';
import {
  initState,
  loadContext,
  markInProgress,
  type StateContext,
} from '../src/state.js';

const CLI_BIN = resolve(__dirname, '..', 'bin', 'caia-chain.js');

interface CliResult {
  stdout: string;
  stderr: string;
  status: number;
}

function runCli(
  bundle: FixtureBundle,
  args: string[],
): CliResult {
  // Commander requires per-subcommand options to follow the verb, so we
  // splice --chain-id / --phases in AFTER args[0] (the verb).
  if (args.length === 0) throw new Error('runCli: args must include the verb');
  const [verb, ...rest] = args;
  const r = spawnSync(
    process.execPath,
    [
      CLI_BIN,
      verb!,
      '--chain-id',
      bundle.chainId,
      '--phases',
      bundle.specPath,
      ...rest,
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        CAIA_CHAIN_HOME: bundle.chainHome,
        CAIA_DISABLE_NOTIFICATIONS: '1',
      },
    },
  );
  return { stdout: r.stdout ?? '', stderr: r.stderr ?? '', status: r.status ?? -1 };
}

function readAuditEvents(ctx: StateContext): Array<Record<string, unknown>> {
  if (!existsSync(ctx.paths.auditFile)) return [];
  return readFileSync(ctx.paths.auditFile, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

describe('caia-chain mark-done — G10 adoption-pending-ok override', () => {
  let bundle: FixtureBundle;
  let ctx: StateContext;

  beforeEach(() => {
    bundle = makeFixture('g10-override');
    ctx = loadContext(bundle.chainId, bundle.specPath);
    initState(ctx);
    // Get phase 1 into in_progress with a lock so mark-done has work to do.
    const sessionId = 'sess-g10-override';
    markInProgress(ctx, '1', sessionId);
    acquireLock(ctx, 1, sessionId);
  });

  afterEach(() => {
    bundle.cleanup();
  });

  it('pass flow — no override flag → phase_done audit, no override event', () => {
    const r = runCli(bundle, ['mark-done', '1']);
    expect(r.status).toBe(0);
    const events = readAuditEvents(ctx);
    const names = events.map((e) => e['event']);
    expect(names).toContain('phase_done');
    expect(names).not.toContain('adoption_gate_override');
  });

  it('override flow — --adoption-pending-ok --reason "<text>" appends the override audit AND completes mark-done', () => {
    const r = runCli(bundle, [
      'mark-done',
      '1',
      '--adoption-pending-ok',
      '--reason',
      'p3-substrate-empty-2026-05-16',
    ]);
    expect(r.status).toBe(0);
    const events = readAuditEvents(ctx);
    const names = events.map((e) => e['event']);
    expect(names).toContain('adoption_gate_override');
    expect(names).toContain('phase_done');
    // The override event MUST come first (we record the intent before
    // mutating state) — preserves the audit trail even if mark-done blows up
    // later in the call chain.
    const overrideIdx = names.indexOf('adoption_gate_override');
    const doneIdx = names.indexOf('phase_done');
    expect(overrideIdx).toBeLessThan(doneIdx);

    const overrideEvt = events.find((e) => e['event'] === 'adoption_gate_override');
    expect(overrideEvt).toBeDefined();
    expect(overrideEvt?.['phase_id']).toBe(1);
    expect(overrideEvt?.['reason']).toBe('p3-substrate-empty-2026-05-16');
  });

  it('block flow — --adoption-pending-ok without --reason exits 2 and writes no override event', () => {
    const r = runCli(bundle, ['mark-done', '1', '--adoption-pending-ok']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--adoption-pending-ok requires --reason');
    const events = readAuditEvents(ctx);
    const names = events.map((e) => e['event']);
    expect(names).not.toContain('adoption_gate_override');
    expect(names).not.toContain('phase_done');
  });

  it('block flow — --adoption-pending-ok with empty --reason "  " is rejected', () => {
    const r = runCli(bundle, [
      'mark-done',
      '1',
      '--adoption-pending-ok',
      '--reason',
      '   ',
    ]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--adoption-pending-ok requires --reason');
    const events = readAuditEvents(ctx);
    expect(events.map((e) => e['event'])).not.toContain('adoption_gate_override');
  });
});
