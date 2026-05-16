// Tests for src/gates/adoption-everywhere.ts (DoD v2 Guardrail #10).
//
// Coverage matrix (per phase-1 prompt + addendum §1):
//   - empty ledger (file missing)            -> ok=true (no-op mode)
//   - empty ledger (file exists, zero rows)  -> ok=true
//   - all rows for chain are 'merged'         -> ok=true
//   - all rows for chain are 'deferred'       -> ok=true
//   - one row in 'opened' (recent)            -> ok=false, reason=pending_state
//   - one row in 'opened' > stuckOpenedDays   -> ok=false, reason=stuck_opened, age_days set
//   - one row in 'failed'                     -> ok=false, reason=pending_state
//   - one row in 'verified' (unknown state)   -> ok=false, reason=unknown_state (defensive)
//   - rows for other chain_id ignored        -> ok=true when own rows are clear
//   - mixed: merged + deferred + opened      -> ok=false (the opened blocks)
//   - malformed JSON lines                    -> counted, do not crash
//   - missing chainId                         -> throws
//   - homeDir override resolves to ~/.caia/adoption/ledger.jsonl

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ADOPTION_BLOCK_STATES,
  ADOPTION_PASS_STATES,
  DEFAULT_STUCK_OPENED_DAYS,
  checkAdoptionGate,
  type AdoptionGateResult,
} from '../../src/gates/adoption-everywhere.js';

let root: string;
let ledgerDir: string;
let ledgerPath: string;

const CHAIN = 'p3-test-chain';

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'caia-adopt-gate-'));
  ledgerDir = join(root, '.caia', 'adoption');
  mkdirSync(ledgerDir, { recursive: true });
  ledgerPath = join(ledgerDir, 'ledger.jsonl');
});

afterEach(() => {
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // ignore
  }
});

function writeLedger(rows: Array<Record<string, unknown> | string>): void {
  const lines = rows.map((r) => (typeof r === 'string' ? r : JSON.stringify(r)));
  writeFileSync(ledgerPath, lines.join('\n') + '\n');
}

function row(extra: Record<string, unknown>): Record<string, unknown> {
  return { chain_id: CHAIN, ...extra };
}

describe('checkAdoptionGate — passing constants', () => {
  it('exports the expected pass set', () => {
    expect(new Set(ADOPTION_PASS_STATES)).toEqual(new Set(['merged', 'deferred']));
  });
  it('exports the expected block set', () => {
    expect(new Set(ADOPTION_BLOCK_STATES)).toEqual(
      new Set(['discovered', 'proposed', 'opened', 'verifying', 'failed', 'dropped']),
    );
  });
  it('default stuck-opened threshold is 14 days (addendum §1)', () => {
    expect(DEFAULT_STUCK_OPENED_DAYS).toBe(14);
  });
});

describe('checkAdoptionGate — empty ledger (v1 no-op mode)', () => {
  it('returns ok=true when the ledger file does not exist', () => {
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.blockers).toEqual([]);
    expect(r.empty_ledger).toBe(true);
    expect(r.total_rows).toBe(0);
    expect(r.ledger_path).toBe(ledgerPath);
  });

  it('returns ok=true when the ledger file exists but is empty', () => {
    writeFileSync(ledgerPath, '');
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.empty_ledger).toBe(true);
  });

  it('returns ok=true when the ledger only has rows for other chains', () => {
    writeLedger([
      { chain_id: 'some-other-chain', state: 'opened' },
      { chain_id: 'yet-another-chain', state: 'failed' },
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.total_rows).toBe(0);
    expect(r.empty_ledger).toBe(false);
  });
});

describe('checkAdoptionGate — all-pass states', () => {
  it('ok=true when every chain row is merged', () => {
    writeLedger([
      row({ opportunity_id: 'op-1', state: 'merged' }),
      row({ opportunity_id: 'op-2', state: 'merged' }),
      row({ opportunity_id: 'op-3', state: 'merged' }),
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.passing_rows).toBe(3);
    expect(r.blockers).toEqual([]);
  });

  it('ok=true when every chain row is deferred (per-site deferral)', () => {
    writeLedger([
      row({ opportunity_id: 'op-d1', state: 'deferred' }),
      row({ opportunity_id: 'op-d2', state: 'deferred' }),
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.passing_rows).toBe(2);
  });

  it('ok=true with mixed merged + deferred', () => {
    writeLedger([
      row({ state: 'merged' }),
      row({ state: 'deferred' }),
      row({ state: 'merged' }),
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.passing_rows).toBe(3);
  });
});

describe('checkAdoptionGate — one pending row blocks', () => {
  it('rejects on opened (recent — pending_state, not stuck)', () => {
    const now = new Date('2026-05-16T12:00:00Z');
    writeLedger([
      row({
        opportunity_id: 'op-pend',
        target_utility: '@chiefaia/hmac-auth',
        target_export: 'sign',
        call_site_file: 'apps/web/server.ts',
        call_site_line: 42,
        state: 'opened',
        opened_at: '2026-05-15T12:00:00Z', // 1d old
      }),
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root, now });
    expect(r.ok).toBe(false);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]).toMatchObject({
      opportunity_id: 'op-pend',
      state: 'opened',
      reason: 'pending_state',
      target_utility: '@chiefaia/hmac-auth',
      target_export: 'sign',
      call_site_file: 'apps/web/server.ts',
      call_site_line: 42,
      opened_at: '2026-05-15T12:00:00Z',
    });
    expect(r.blockers[0]!.age_days).toBeUndefined();
    expect(r.passing_rows).toBe(0);
    expect(r.total_rows).toBe(1);
  });

  it('rejects on discovered / proposed / verifying / failed / dropped', () => {
    const blockingStates = ['discovered', 'proposed', 'verifying', 'failed', 'dropped'];
    for (const state of blockingStates) {
      writeLedger([row({ opportunity_id: `op-${state}`, state })]);
      const r = checkAdoptionGate(CHAIN, { homeDir: root });
      expect(r.ok, `state=${state} should block`).toBe(false);
      expect(r.blockers[0]!.reason).toBe('pending_state');
      expect(r.blockers[0]!.state).toBe(state);
    }
  });

  it('still passes other chains when this chain has one pending row', () => {
    writeLedger([
      row({ state: 'opened', opened_at: '2026-05-16T00:00:00Z' }),
      { chain_id: 'other', state: 'merged' },
    ]);
    const r = checkAdoptionGate(CHAIN, {
      homeDir: root,
      now: new Date('2026-05-16T01:00:00Z'),
    });
    expect(r.ok).toBe(false);
    expect(r.total_rows).toBe(1);
    expect(r.blockers).toHaveLength(1);
  });
});

describe('checkAdoptionGate — stuck-opened (>14d)', () => {
  it('blocks with reason=stuck_opened when opened_at > 14d ago', () => {
    const now = new Date('2026-05-16T12:00:00Z');
    writeLedger([
      row({
        opportunity_id: 'op-stuck',
        state: 'opened',
        opened_at: '2026-04-15T12:00:00Z', // 31d old
      }),
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root, now });
    expect(r.ok).toBe(false);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]!.reason).toBe('stuck_opened');
    expect(r.blockers[0]!.opportunity_id).toBe('op-stuck');
    expect(r.blockers[0]!.age_days).toBeGreaterThan(14);
    expect(r.blockers[0]!.age_days).toBeLessThan(32);
  });

  it('right at the boundary (14.0d) is still pending_state, just over is stuck_opened', () => {
    const now = new Date('2026-05-16T12:00:00Z');
    // exactly 14d old -> NOT stuck (age > 14, strictly)
    writeLedger([row({ state: 'opened', opened_at: '2026-05-02T12:00:00Z' })]);
    const exactly14 = checkAdoptionGate(CHAIN, { homeDir: root, now });
    expect(exactly14.blockers[0]!.reason).toBe('pending_state');

    // 14.01d old -> stuck
    writeLedger([row({ state: 'opened', opened_at: '2026-05-02T11:45:00Z' })]);
    const justOver = checkAdoptionGate(CHAIN, { homeDir: root, now });
    expect(justOver.blockers[0]!.reason).toBe('stuck_opened');
  });

  it('honors stuckOpenedDays override', () => {
    const now = new Date('2026-05-16T12:00:00Z');
    writeLedger([row({ state: 'opened', opened_at: '2026-05-10T12:00:00Z' })]); // 6d old
    const def = checkAdoptionGate(CHAIN, { homeDir: root, now });
    expect(def.blockers[0]!.reason).toBe('pending_state'); // not stuck @ 14d
    const tight = checkAdoptionGate(CHAIN, { homeDir: root, now, stuckOpenedDays: 5 });
    expect(tight.blockers[0]!.reason).toBe('stuck_opened'); // stuck @ 5d
  });

  it('opened without opened_at degrades to pending_state (no crash)', () => {
    writeLedger([row({ state: 'opened' /* no opened_at */ })]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]!.reason).toBe('pending_state');
  });

  it('unparseable opened_at degrades to pending_state', () => {
    writeLedger([row({ state: 'opened', opened_at: 'not-a-date' })]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.blockers[0]!.reason).toBe('pending_state');
  });
});

describe('checkAdoptionGate — defensive states (substrate drift)', () => {
  it('verified is treated as unknown_state (blocks)', () => {
    writeLedger([row({ state: 'verified' })]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]!.reason).toBe('unknown_state');
  });

  it('any future state not in pass set blocks', () => {
    writeLedger([row({ state: 'a-future-state' })]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]!.reason).toBe('unknown_state');
  });

  it('row with no state at all blocks as unknown_state', () => {
    writeLedger([row({ opportunity_id: 'op-no-state' })]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(false);
    expect(r.blockers[0]!.reason).toBe('unknown_state');
    expect(r.blockers[0]!.state).toBe('<missing>');
  });
});

describe('checkAdoptionGate — mixed states', () => {
  it('one block dominates many passes', () => {
    writeLedger([
      row({ opportunity_id: 'a', state: 'merged' }),
      row({ opportunity_id: 'b', state: 'merged' }),
      row({ opportunity_id: 'c', state: 'deferred' }),
      row({
        opportunity_id: 'd',
        state: 'opened',
        opened_at: '2026-05-16T00:00:00Z',
      }),
    ]);
    const r = checkAdoptionGate(CHAIN, {
      homeDir: root,
      now: new Date('2026-05-16T06:00:00Z'),
    });
    expect(r.ok).toBe(false);
    expect(r.total_rows).toBe(4);
    expect(r.passing_rows).toBe(3);
    expect(r.blockers).toHaveLength(1);
    expect(r.blockers[0]!.opportunity_id).toBe('d');
  });

  it('preserves blocker order from ledger', () => {
    writeLedger([
      row({ opportunity_id: 'first-block', state: 'failed' }),
      row({ opportunity_id: 'pass', state: 'merged' }),
      row({ opportunity_id: 'second-block', state: 'proposed' }),
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.blockers.map((b) => b.opportunity_id)).toEqual([
      'first-block',
      'second-block',
    ]);
  });
});

describe('checkAdoptionGate — malformed / robustness', () => {
  it('skips malformed JSON lines and counts them', () => {
    writeLedger([
      'not-json',
      JSON.stringify(row({ state: 'merged' })),
      '{"chain_id":', // truncated
      JSON.stringify(row({ state: 'merged' })),
      '"a-string-not-an-object"',
    ]);
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.total_rows).toBe(2);
    expect(r.malformed_lines).toBe(3);
  });

  it('tolerates blank lines', () => {
    writeFileSync(
      ledgerPath,
      '\n\n' + JSON.stringify(row({ state: 'merged' })) + '\n\n\n',
    );
    const r = checkAdoptionGate(CHAIN, { homeDir: root });
    expect(r.ok).toBe(true);
    expect(r.total_rows).toBe(1);
  });

  it('throws when chainId is missing or empty', () => {
    expect(() => checkAdoptionGate('', { homeDir: root })).toThrow();
    // @ts-expect-error — runtime guard for non-string callers
    expect(() => checkAdoptionGate(undefined)).toThrow();
  });

  it('ledgerPath override wins over homeDir', () => {
    const otherPath = join(root, 'custom-ledger.jsonl');
    writeFileSync(otherPath, JSON.stringify(row({ state: 'opened', opened_at: '2026-05-16T00:00:00Z' })) + '\n');
    const r: AdoptionGateResult = checkAdoptionGate(CHAIN, {
      ledgerPath: otherPath,
      now: new Date('2026-05-16T01:00:00Z'),
    });
    expect(r.ledger_path).toBe(otherPath);
    expect(r.ok).toBe(false);
  });
});
