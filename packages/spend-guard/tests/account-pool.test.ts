/**
 * Account pool — serial fallback (Prakash 2026-04-30 update).
 */

import { describe, it, expect } from 'vitest';
import {
  AccountPool,
  type AccountState,
} from '../src/index.js';

function acct(
  id: string,
  weeklyCapUsd: number,
  weekUsd = 0,
  flags: Partial<AccountState> = {},
): AccountState {
  return {
    accountId: id,
    weekUsd,
    weeklyCapUsd,
    lastRotationMsEpoch: 0,
    rateLimited: false,
    suspended: false,
    ...flags,
  };
}

describe('AccountPool — multi mode (default)', () => {
  it('emits a one-time ToS-fragility warning on construction', () => {
    const log: string[] = [];
    new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100), acct('b', 100)],
      log: (ev) => log.push(ev.kind),
    });
    expect(log.filter((k) => k === 'tos-warning')).toHaveLength(1);
  });

  it('does NOT emit the ToS warning when only one account is configured', () => {
    const log: string[] = [];
    new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100)],
      log: (ev) => log.push(ev.kind),
    });
    expect(log.includes('tos-warning')).toBe(false);
  });

  it('routes to the first account that has remaining weekly cap', () => {
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 99), acct('b', 100, 50)],
    });
    const r = pool.route({ estimatedUsd: 1.5 });
    expect(r.via).toBe('subscription');
    expect(r.accountId).toBe('b');
  });

  it('falls through to API key when all accounts are exhausted', () => {
    const log: string[] = [];
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 100), acct('b', 100, 100)],
      log: (ev) => log.push(ev.kind),
    });
    const r = pool.route({ estimatedUsd: 1 });
    expect(r.via).toBe('api-key');
    expect(r.accountId).toBeNull();
    expect(log.includes('fallback-to-api-key')).toBe(true);
  });

  it('skips rate-limited accounts but uses the next one', () => {
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 0, { rateLimited: true }), acct('b', 100, 0)],
    });
    const r = pool.route({ estimatedUsd: 1 });
    expect(r.via).toBe('subscription');
    expect(r.accountId).toBe('b');
  });

  it('skips suspended accounts entirely', () => {
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 0, { suspended: true }), acct('b', 100, 0)],
    });
    const r = pool.route({ estimatedUsd: 1 });
    expect(r.via).toBe('subscription');
    expect(r.accountId).toBe('b');
  });

  it('emits "rotated" when the active account changes', () => {
    const log: Array<{ kind: string; [k: string]: unknown }> = [];
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 100), acct('b', 100, 0)],
      log: (ev) => log.push(ev as { kind: string }),
    });
    pool.route({ estimatedUsd: 1 });
    const rotated = log.filter((e) => e.kind === 'rotated');
    expect(rotated[0]?.['from']).toBeNull();
    expect(rotated[0]?.['to']).toBe('b');
  });

  it('applySpend updates the account weekly counter', () => {
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 0)],
    });
    pool.applySpend({ accountId: 'a', usd: 10 });
    expect(pool.snapshot().accounts[0]?.weekUsd).toBe(10);
  });

  it('markRateLimited sets the flag, clearRateLimited unsets it', () => {
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 0)],
    });
    pool.markRateLimited('a');
    expect(pool.snapshot().accounts[0]?.rateLimited).toBe(true);
    pool.clearRateLimited('a');
    expect(pool.snapshot().accounts[0]?.rateLimited).toBe(false);
  });
});

describe('AccountPool — single mode', () => {
  it('uses only the first account even with two configured', () => {
    const pool = new AccountPool({
      mode: 'single',
      accounts: [acct('a', 100, 100), acct('b', 100, 0)],
    });
    const r = pool.route({ estimatedUsd: 1 });
    // 'a' is exhausted; 'b' is ignored in single mode → API key fallback.
    expect(r.via).toBe('api-key');
  });
});

describe('AccountPool — api-fallback mode', () => {
  it('always returns api-key without consulting accounts', () => {
    const pool = new AccountPool({
      mode: 'api-fallback',
      accounts: [acct('a', 100, 0)],
    });
    expect(pool.route({ estimatedUsd: 1 }).via).toBe('api-key');
  });
});

describe('AccountPool.snapshot', () => {
  it('returns a deep-ish snapshot the dashboard can render', () => {
    const pool = new AccountPool({
      mode: 'multi',
      accounts: [acct('a', 100, 50), acct('b', 100, 0)],
    });
    const snap = pool.snapshot();
    expect(snap.mode).toBe('multi');
    expect(snap.accounts).toHaveLength(2);
    expect(snap.accounts[0]?.accountId).toBe('a');
  });
});
