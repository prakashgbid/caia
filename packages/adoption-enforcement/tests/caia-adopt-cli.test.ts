// Golden-output tests for the `caia-adopt gate-check` CLI verb (DoD v2 G10
// phase 2). Spawns the bin script with vetted ledger fixtures and asserts on
// stdout, stderr, and exit code so the script's interface contract with
// scripts/gate-mark-done.sh (and any future caller) is preserved.
//
// Three flows are covered:
//   - pass     : ledger has no blockers for the chain → exit 0, "PASS" line
//   - block    : ledger has a pending row for the chain → exit 1, "BLOCK" line
//   - override : --json output (machine surface used by override workflows
//                to print the diagnostic before invoking
//                `caia-chain mark-done --adoption-pending-ok`).

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const BIN = resolve(__dirname, '..', 'bin', 'caia-adopt.mjs');

let root: string;
let ledgerPath: string;

const CHAIN = 'p3-cli-test-chain';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'caia-adopt-cli-'));
  mkdirSync(root, { recursive: true });
  ledgerPath = join(root, 'ledger.jsonl');
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeLedger(rows: Array<Record<string, unknown>>): void {
  writeFileSync(ledgerPath, rows.map((r) => JSON.stringify(r)).join('\n') + '\n');
}

function run(args: string[]): { stdout: string; stderr: string; status: number } {
  const r = spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_NO_WARNINGS: '1' },
  });
  return {
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
    status: r.status ?? -1,
  };
}

describe('caia-adopt — usage', () => {
  it('prints the top-level usage with no verb and exits 2', () => {
    const r = run([]);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain('Usage: caia-adopt <verb>');
    expect(r.stdout).toContain('gate-check');
  });

  it('exits 0 on --help', () => {
    const r = run(['--help']);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain('Usage: caia-adopt <verb>');
  });

  it('rejects an unknown verb with exit 2', () => {
    const r = run(['frobnicate']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown verb: frobnicate');
  });
});

describe('caia-adopt gate-check — pass flow', () => {
  it('exits 0 and prints PASS when the ledger is empty (v1 no-op)', () => {
    // Don't write a ledger — empty/missing is the v1 no-op.
    const r = run(['gate-check', '--chain', CHAIN, '--ledger', ledgerPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^PASS chain=p3-cli-test-chain blockers=0 passing=0\/0 ledger=/);
    expect(r.stdout).toContain('empty ledger — v1 no-op mode');
  });

  it('exits 0 and prints PASS when every row is merged/deferred', () => {
    writeLedger([
      { chain_id: CHAIN, state: 'merged', opportunity_id: 'opp-1' },
      { chain_id: CHAIN, state: 'deferred', opportunity_id: 'opp-2' },
      { chain_id: 'other-chain', state: 'opened', opportunity_id: 'noise' },
    ]);
    const r = run(['gate-check', '--chain', CHAIN, '--ledger', ledgerPath]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/^PASS chain=p3-cli-test-chain blockers=0 passing=2\/2 ledger=/);
    // Rows belonging to other chains never appear in the count.
    expect(r.stdout).not.toContain('noise');
  });
});

describe('caia-adopt gate-check — block flow', () => {
  it('exits 1 and lists each blocker with state + reason', () => {
    writeLedger([
      {
        chain_id: CHAIN,
        state: 'opened',
        opportunity_id: 'opp-open',
        target_utility: 'utilA',
        target_export: 'foo',
        call_site_file: 'a.ts',
        call_site_line: 42,
      },
      {
        chain_id: CHAIN,
        state: 'failed',
        opportunity_id: 'opp-fail',
        target_utility: 'utilB',
      },
      {
        chain_id: CHAIN,
        state: 'merged',
        opportunity_id: 'opp-ok',
      },
    ]);
    const r = run(['gate-check', '--chain', CHAIN, '--ledger', ledgerPath]);
    expect(r.status).toBe(1);
    expect(r.stdout).toMatch(/^BLOCK chain=p3-cli-test-chain blockers=2 passing=1\/3 ledger=/);
    expect(r.stdout).toContain('opp-open state=opened reason=pending_state');
    expect(r.stdout).toContain('target=utilA/foo');
    expect(r.stdout).toContain('site=a.ts:42');
    expect(r.stdout).toContain('opp-fail state=failed reason=pending_state');
    expect(r.stdout).toContain('override: caia-chain mark-done <phase> --adoption-pending-ok --reason "<why>"');
  });

  it('exits 1 and surfaces stuck_opened separately', () => {
    // opened_at is 30 days before "now". The default threshold is 14d so this
    // row must surface as reason=stuck_opened with the override hint visible.
    const openedAt = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    writeLedger([
      {
        chain_id: CHAIN,
        state: 'opened',
        opportunity_id: 'opp-stuck',
        opened_at: openedAt,
      },
    ]);
    const r = run(['gate-check', '--chain', CHAIN, '--ledger', ledgerPath]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('opp-stuck state=opened reason=stuck_opened');
    expect(r.stdout).toMatch(/age=\d+\.\d+d/);
  });
});

describe('caia-adopt gate-check — override (machine-readable) flow', () => {
  it('emits JSON the override workflow can parse, ok=false', () => {
    writeLedger([
      {
        chain_id: CHAIN,
        state: 'opened',
        opportunity_id: 'opp-1',
      },
    ]);
    const r = run(['gate-check', '--chain', CHAIN, '--ledger', ledgerPath, '--json']);
    expect(r.status).toBe(1);
    const parsed = JSON.parse(r.stdout) as {
      chain: string;
      ok: boolean;
      blockers: Array<{ opportunity_id?: string; state: string; reason: string }>;
      total_rows: number;
      passing_rows: number;
      ledger_path: string;
    };
    expect(parsed.chain).toBe(CHAIN);
    expect(parsed.ok).toBe(false);
    expect(parsed.blockers).toHaveLength(1);
    expect(parsed.blockers[0]?.opportunity_id).toBe('opp-1');
    expect(parsed.blockers[0]?.reason).toBe('pending_state');
    expect(parsed.passing_rows).toBe(0);
    expect(parsed.total_rows).toBe(1);
    expect(parsed.ledger_path).toBe(ledgerPath);
  });

  it('emits JSON with ok=true on the empty-ledger pass path', () => {
    const r = run(['gate-check', '--chain', CHAIN, '--ledger', ledgerPath, '--json']);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout) as {
      ok: boolean;
      empty_ledger: boolean;
      blockers: unknown[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.empty_ledger).toBe(true);
    expect(parsed.blockers).toEqual([]);
  });
});

describe('caia-adopt gate-check — argument validation', () => {
  it('exits 2 when --chain is missing', () => {
    const r = run(['gate-check']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--chain <chain-id> is required');
  });

  it('exits 2 on unknown options', () => {
    const r = run(['gate-check', '--chain', CHAIN, '--bogus']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('unknown gate-check option: --bogus');
  });

  it('exits 2 when --stuck-opened-days is non-numeric', () => {
    const r = run(['gate-check', '--chain', CHAIN, '--stuck-opened-days', 'lots']);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('--stuck-opened-days must be a non-negative number');
  });
});
