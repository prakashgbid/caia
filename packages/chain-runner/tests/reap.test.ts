// Tests for H-6 reap-orphans. The critical safety property: live workers
// for `in_progress` phases must NEVER be reaped. Every test exercises a
// mocked ps snapshot + injected state reader + injected killer so the test
// suite never touches a real process.

import { describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  DEFAULT_RUNNER_MAP,
  defaultReadState,
  etimeToSeconds,
  findRunnerAncestor,
  formatReapReport,
  loadRunnerMap,
  parsePs,
  reapOrphans,
  type PsEntry,
} from '../src/reap.js';
import type { StateFile } from '../src/types.js';

function ps(
  entries: Array<Partial<PsEntry> & Pick<PsEntry, 'pid' | 'ppid' | 'command'>>,
): PsEntry[] {
  return entries.map((e) => ({
    pid: e.pid,
    ppid: e.ppid,
    etime: e.etime ?? '00:30',
    command: e.command,
  }));
}

function state(phaseStatus: Record<number, string>): StateFile {
  const phase_status: Record<string, { status: string }> = {};
  for (const [k, v] of Object.entries(phaseStatus)) {
    phase_status[String(k)] = { status: v };
  }
  return {
    schema_version: 1,
    started_at: '2026-05-14T00:00:00Z',
    last_wake: null,
    paused: false,
    budget_consumed_pct: 0,
    budget_cap_pct: 25,
    phase_status: phase_status as unknown as StateFile['phase_status'],
    current_phase: null,
    all_done: false,
  };
}

describe('parsePs', () => {
  it('parses a typical ps -axo output with header', () => {
    const raw = [
      '  PID  PPID ELAPSED COMMAND',
      '  100     1 00:05:00 /sbin/launchd',
      '  500   100   00:02:00 /bin/bash _chain_harden_run_phase.sh 7 sess123 /tmp/prompt.txt',
      '  600   500   00:01:30 /opt/claude/bin/claude --permission-mode bypassPermissions --print',
    ].join('\n');
    const out = parsePs(raw);
    expect(out).toHaveLength(3);
    expect(out[0]).toEqual({
      pid: 100,
      ppid: 1,
      etime: '00:05:00',
      command: '/sbin/launchd',
    });
    expect(out[2]?.pid).toBe(600);
    expect(out[2]?.command).toMatch(/^\/opt\/claude\/bin\/claude/);
  });

  it('skips blank lines and malformed rows', () => {
    const raw = ['  PID  PPID ELAPSED COMMAND', '', '  not a real row', '  42 1 00:01 /bin/init'].join('\n');
    const out = parsePs(raw);
    expect(out).toHaveLength(1);
    expect(out[0]?.pid).toBe(42);
  });
});

describe('etimeToSeconds', () => {
  it('parses SS form', () => expect(etimeToSeconds('45')).toBe(45));
  it('parses MM:SS form', () => expect(etimeToSeconds('05:30')).toBe(330));
  it('parses HH:MM:SS form', () => expect(etimeToSeconds('01:00:00')).toBe(3600));
  it('parses D-HH:MM:SS form', () => expect(etimeToSeconds('2-03:04:05')).toBe(2 * 86400 + 3 * 3600 + 4 * 60 + 5));
  it('returns 0 for empty / nonsense', () => {
    expect(etimeToSeconds('')).toBe(0);
    expect(etimeToSeconds('hello')).toBe(0);
  });
});

describe('findRunnerAncestor', () => {
  it('walks the parent chain and returns chain+phase from a known runner', () => {
    const entries = ps([
      { pid: 100, ppid: 1, command: '/sbin/launchd' },
      { pid: 200, ppid: 100, command: 'bash _chain_harden_run_phase.sh 7 sess123 /tmp/p.txt' },
      { pid: 300, ppid: 200, command: 'claude --permission-mode bypassPermissions --print' },
    ]);
    const byPid = new Map(entries.map((e) => [e.pid, e]));
    const r = findRunnerAncestor(300, byPid, { ...DEFAULT_RUNNER_MAP });
    expect(r?.chainId).toBe('chain-runner-battle-harden');
    expect(r?.phaseId).toBe(7);
  });

  it('returns null when no runner ancestor is found', () => {
    const entries = ps([
      { pid: 100, ppid: 1, command: '/sbin/launchd' },
      { pid: 300, ppid: 100, command: 'claude --permission-mode bypassPermissions --print' },
    ]);
    const byPid = new Map(entries.map((e) => [e.pid, e]));
    expect(findRunnerAncestor(300, byPid, { ...DEFAULT_RUNNER_MAP })).toBeNull();
  });

  it('does not loop forever on a cyclic ppid chain', () => {
    const entries = ps([
      { pid: 100, ppid: 200, command: 'sh' },
      { pid: 200, ppid: 100, command: 'sh' },
    ]);
    const byPid = new Map(entries.map((e) => [e.pid, e]));
    expect(findRunnerAncestor(100, byPid, { ...DEFAULT_RUNNER_MAP })).toBeNull();
  });

  it('respects CAIA_REAP_RUNNER_MAP env override', () => {
    const map = loadRunnerMap({
      CAIA_REAP_RUNNER_MAP: JSON.stringify({ '_custom_run_phase.sh': 'custom-chain' }),
    });
    expect(map['_custom_run_phase.sh']).toBe('custom-chain');
    // defaults still present
    expect(map['_chain_harden_run_phase.sh']).toBe('chain-runner-battle-harden');
  });
});

describe('reapOrphans — orphan detection', () => {
  it('flags a claude child whose phase is done as an orphan, and reaps it (non-dry-run)', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: '/sbin/launchd' },
      { pid: 200, ppid: 100, command: 'bash _chain_harden_run_phase.sh 3 sess123 /tmp/p.txt' },
      { pid: 300, ppid: 200, command: '/opt/claude/bin/claude --permission-mode bypassPermissions --print', etime: '10:00' },
    ]);
    const readState = vi.fn(() => state({ 3: 'done' }));
    const kill = vi.fn(() => 'esrch' as const); // already-gone after SIGTERM — short-circuits the wait
    const isAlive = vi.fn(() => false);
    const sleep = vi.fn(async () => undefined);
    const auditFn = vi.fn();
    const r = await reapOrphans({
      psSnapshot: snapshot,
      readState,
      kill,
      isAlive,
      sleep,
      appendAuditFn: auditFn,
      reapLogPath: null,
    });
    expect(r.candidates).toBe(1);
    expect(r.suspects).toBe(1);
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0]?.isOrphan).toBe(true);
    expect(r.orphans[0]?.phaseStatus).toBe('done');
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]?.outcome).toBe('already_gone');
    expect(kill).toHaveBeenCalledWith(300, 'SIGTERM');
    expect(auditFn).toHaveBeenCalled();
  });

  it('NEVER reaps a claude child whose phase is in_progress (safety property)', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: '/sbin/launchd' },
      { pid: 200, ppid: 100, command: 'bash _chain_harden_run_phase.sh 3 sess123 /tmp/p.txt' },
      { pid: 300, ppid: 200, command: 'claude --permission-mode bypassPermissions --print', etime: '10:00' },
    ]);
    const kill = vi.fn(() => 'sent' as const);
    const isAlive = vi.fn(() => false);
    const sleep = vi.fn(async () => undefined);
    const r = await reapOrphans({
      psSnapshot: snapshot,
      readState: () => state({ 3: 'in_progress' }),
      kill,
      isAlive,
      sleep,
      reapLogPath: null,
    });
    expect(r.orphans).toHaveLength(1);
    expect(r.orphans[0]?.isOrphan).toBe(false);
    expect(r.actions).toHaveLength(0);
    expect(kill).not.toHaveBeenCalled();
  });

  it('dry-run reports orphans but never kills', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: '/sbin/launchd' },
      { pid: 200, ppid: 100, command: 'bash _chain_harden_run_phase.sh 5 s /tmp/p.txt' },
      { pid: 300, ppid: 200, command: 'claude --permission-mode bypassPermissions --print', etime: '02:00' },
    ]);
    const kill = vi.fn(() => 'sent' as const);
    const r = await reapOrphans({
      dryRun: true,
      psSnapshot: snapshot,
      readState: () => state({ 5: 'blocked' }),
      kill,
      isAlive: () => true,
      sleep: async () => undefined,
      reapLogPath: null,
    });
    expect(r.dryRun).toBe(true);
    expect(r.actions[0]?.outcome).toBe('skipped_dry_run');
    expect(kill).not.toHaveBeenCalled();
  });

  it('SIGKILLs after grace when SIGTERM did not kill the process', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: '/sbin/launchd' },
      { pid: 200, ppid: 100, command: 'bash _chain_harden_run_phase.sh 9 s /tmp/p.txt' },
      { pid: 300, ppid: 200, command: 'claude --permission-mode bypassPermissions --print', etime: '60:00' },
    ]);
    const kill = vi.fn((_pid: number, sig: NodeJS.Signals) => ('sent' as const));
    const isAlive = vi.fn(() => true); // still alive after SIGTERM grace
    const sleep = vi.fn(async () => undefined);
    const r = await reapOrphans({
      psSnapshot: snapshot,
      readState: () => state({ 9: 'failed' }),
      kill,
      isAlive,
      sleep,
      termGraceMs: 1, // dont actually wait
      reapLogPath: null,
    });
    expect(r.actions[0]?.outcome).toBe('kill');
    expect(kill).toHaveBeenNthCalledWith(1, 300, 'SIGTERM');
    expect(kill).toHaveBeenNthCalledWith(2, 300, 'SIGKILL');
  });

  it('respects --chain-id filter and ignores orphans from other chains', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: 'launchd' },
      // chain A
      { pid: 200, ppid: 100, command: 'bash _chain_harden_run_phase.sh 1 s /tmp/p.txt' },
      { pid: 201, ppid: 200, command: 'claude --permission-mode bypassPermissions --print', etime: '5:00' },
      // chain B (different runner)
      { pid: 300, ppid: 100, command: 'bash _redflag_remediation_run_phase.sh 2 s /tmp/p.txt' },
      { pid: 301, ppid: 300, command: 'claude --permission-mode bypassPermissions --print', etime: '5:00' },
    ]);
    const kill = vi.fn(() => 'esrch' as const);
    const r = await reapOrphans({
      chainId: 'chain-runner-battle-harden',
      psSnapshot: snapshot,
      readState: () => state({ 1: 'done', 2: 'done' }),
      kill,
      isAlive: () => false,
      sleep: async () => undefined,
      reapLogPath: null,
    });
    expect(r.suspects).toBe(1);
    expect(r.orphans[0]?.chainId).toBe('chain-runner-battle-harden');
  });

  it('returns 0 candidates when no claude --print children exist', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: '/sbin/launchd' },
      { pid: 200, ppid: 100, command: '/usr/bin/zsh' },
    ]);
    const r = await reapOrphans({
      psSnapshot: snapshot,
      readState: () => null,
      reapLogPath: null,
    });
    expect(r.candidates).toBe(0);
    expect(r.suspects).toBe(0);
  });

  it('returns 0 suspects for a claude --print orphan with no known runner ancestor', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: 'launchd' },
      { pid: 300, ppid: 100, command: 'claude --permission-mode bypassPermissions --print', etime: '5:00' },
    ]);
    const r = await reapOrphans({
      psSnapshot: snapshot,
      readState: () => state({ 1: 'done' }),
      reapLogPath: null,
    });
    expect(r.candidates).toBe(1);
    expect(r.suspects).toBe(0);
  });

  it('audits per-chain on reap', async () => {
    const snapshot = ps([
      { pid: 100, ppid: 1, command: 'launchd' },
      { pid: 200, ppid: 100, command: 'bash _chain_harden_run_phase.sh 4 s /tmp/p.txt' },
      { pid: 300, ppid: 200, command: 'claude --permission-mode bypassPermissions --print', etime: '8:00' },
    ]);
    const auditFn = vi.fn();
    await reapOrphans({
      psSnapshot: snapshot,
      readState: () => state({ 4: 'done' }),
      kill: () => 'esrch',
      isAlive: () => false,
      sleep: async () => undefined,
      appendAuditFn: auditFn,
      reapLogPath: null,
    });
    expect(auditFn).toHaveBeenCalled();
    const call = auditFn.mock.calls[0]!;
    expect(call[1]).toBe('orphan_reaped');
    expect(call[2]).toMatchObject({ phase_id: 4, pid: 300, outcome: 'already_gone' });
  });
});

describe('formatReapReport', () => {
  it('renders the summary + per-orphan + per-action lines', () => {
    const out = formatReapReport({
      scannedAt: '2026-05-14T01:00:00Z',
      candidates: 2,
      suspects: 2,
      orphans: [
        {
          pid: 300,
          ppid: 200,
          command: 'claude --print',
          ageSec: 600,
          chainId: 'chain-runner-battle-harden',
          phaseId: 4,
          runnerScript: '_chain_harden_run_phase.sh',
          phaseStatus: 'done',
          isOrphan: true,
        },
        {
          pid: 301,
          ppid: 200,
          command: 'claude --print',
          ageSec: 60,
          chainId: 'chain-runner-battle-harden',
          phaseId: 4,
          runnerScript: '_chain_harden_run_phase.sh',
          phaseStatus: 'in_progress',
          isOrphan: false,
        },
      ],
      actions: [
        {
          pid: 300,
          chainId: 'chain-runner-battle-harden',
          phaseId: 4,
          outcome: 'term',
          ageSec: 600,
          command: 'claude --print',
        },
      ],
      dryRun: false,
    });
    expect(out).toMatch(/candidates=2/);
    expect(out).toMatch(/orphans=1/);
    expect(out).toMatch(/pid=300.*orphan=true/);
    expect(out).toMatch(/action pid=300.*outcome=term/);
  });
});

describe('defaultReadState', () => {
  it('returns null when the chain dir does not exist', () => {
    // chainPaths requires a valid id; defaultReadState should swallow ENOENT.
    process.env['CAIA_CHAIN_HOME'] = mkdtempSync(join(tmpdir(), 'caia-cr-reap-state-'));
    expect(defaultReadState('definitely-does-not-exist')).toBeNull();
    delete process.env['CAIA_CHAIN_HOME'];
  });

  it('loads a valid state.json', () => {
    const root = mkdtempSync(join(tmpdir(), 'caia-cr-reap-state-'));
    const chainId = 'rs-test-chain';
    mkdirSync(join(root, chainId), { recursive: true });
    writeFileSync(
      join(root, chainId, 'state.json'),
      JSON.stringify({ phase_status: { '1': { status: 'done' } } }),
    );
    process.env['CAIA_CHAIN_HOME'] = root;
    try {
      const s = defaultReadState(chainId);
      expect(s?.phase_status['1']?.status).toBe('done');
    } finally {
      delete process.env['CAIA_CHAIN_HOME'];
    }
  });
});
