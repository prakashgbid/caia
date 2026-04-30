/**
 * Anthropic account pool — serial fallback (per Prakash 2026-04-30 update,
 * reversing v2 §6.4's single-account default).
 *
 * Default mode: `multi` with 2 accounts. Falls through serially:
 *   account-2 → account-1 → API key sticker rate (api-fallback)
 *
 * No parallel arbitrage. The ToS-fragility warning is logged once at
 * startup, then suppressed.
 *
 * If/when an account is suspended or banned, the operator flips
 * `ANTHROPIC_ACCOUNT_POOL_MODE=single` (or `=api-fallback`) and restarts.
 *
 * Reference: caia/docs/spend-guard.md §"Account pool", Prakash 2026-04-30.
 */

import {
  AccountStateSchema,
  type AccountPoolMode,
  type AccountState,
} from './types.js';

export interface AccountPoolOptions {
  mode: AccountPoolMode;
  accounts: ReadonlyArray<AccountState>;
  /** Logger called on rotation + ToS warning. */
  log?: (
    ev:
      | { kind: 'rotated'; from: string | null; to: string }
      | { kind: 'tos-warning'; mode: AccountPoolMode; accountCount: number }
      | { kind: 'fallback-to-api-key'; reason: string },
  ) => void;
  /** Test seam — wall-clock. */
  nowMs?: () => number;
}

export interface RouteDecision {
  via: 'subscription' | 'api-key';
  accountId: string | null;
  /** Free-form reason that explains the choice (used by audit logs). */
  reason: string;
}

export class AccountPool {
  private readonly mode: AccountPoolMode;
  private readonly accounts: AccountState[];
  private readonly log: AccountPoolOptions['log'];
  private readonly nowMs: () => number;
  private warned = false;

  constructor(opts: AccountPoolOptions) {
    this.mode = opts.mode;
    this.accounts = opts.accounts.map((a) => AccountStateSchema.parse(a));
    if (opts.log) this.log = opts.log;
    this.nowMs = opts.nowMs ?? (() => Date.now());

    // ToS-fragility warning fires once on construction when in multi-mode
    // with > 1 account. Informational only; not blocking.
    if (this.mode === 'multi' && this.accounts.length > 1) {
      this.warn();
    }
  }

  /**
   * Pick an account for the next request. Serial fallback:
   *   1. The first non-suspended, non-rate-limited account whose
   *      remaining weekly budget covers the request.
   *   2. If all accounts are exhausted / rate-limited / suspended, fall
   *      through to API-key sticker rate.
   */
  route(opts: { estimatedUsd: number }): RouteDecision {
    if (this.mode === 'api-fallback') {
      return {
        via: 'api-key',
        accountId: null,
        reason: 'pool mode=api-fallback (operator-forced)',
      };
    }
    const candidates = this.mode === 'single' ? this.accounts.slice(0, 1) : this.accounts;
    const prevWinner: string | null = null;
    for (const acct of candidates) {
      if (acct.suspended) continue;
      if (acct.rateLimited) continue;
      const remaining = acct.weeklyCapUsd - acct.weekUsd;
      if (remaining < opts.estimatedUsd) continue;
      if (prevWinner !== acct.accountId) {
        this.log?.({ kind: 'rotated', from: prevWinner, to: acct.accountId });
      }
      acct.lastRotationMsEpoch = this.nowMs();
      return {
        via: 'subscription',
        accountId: acct.accountId,
        reason: `pool mode=${this.mode} chose '${acct.accountId}' (remaining=${remaining.toFixed(2)} USD)`,
      };
    }
    this.log?.({
      kind: 'fallback-to-api-key',
      reason:
        'no subscription account had capacity (suspended/rate-limited/exhausted); falling through to api-key sticker rate',
    });
    return {
      via: 'api-key',
      accountId: null,
      reason: 'all subscription accounts exhausted / rate-limited / suspended',
    };
  }

  /** Apply a real spend so subsequent routing reflects current usage. */
  applySpend(opts: { accountId: string; usd: number }): void {
    const acct = this.accounts.find((a) => a.accountId === opts.accountId);
    if (!acct) return;
    acct.weekUsd = Number((acct.weekUsd + opts.usd).toFixed(6));
  }

  /** Mark an account rate-limited (Anthropic returned 429). */
  markRateLimited(accountId: string): void {
    const acct = this.accounts.find((a) => a.accountId === accountId);
    if (acct) acct.rateLimited = true;
  }

  /** Clear rate-limit flag (next reset window). */
  clearRateLimited(accountId: string): void {
    const acct = this.accounts.find((a) => a.accountId === accountId);
    if (acct) acct.rateLimited = false;
  }

  /** Snapshot for the dashboard widget. */
  snapshot(): {
    mode: AccountPoolMode;
    accounts: ReadonlyArray<AccountState>;
  } {
    return {
      mode: this.mode,
      accounts: this.accounts.map((a) => ({ ...a })),
    };
  }

  private warn(): void {
    if (this.warned) return;
    this.warned = true;
    this.log?.({
      kind: 'tos-warning',
      mode: this.mode,
      accountCount: this.accounts.length,
    });
  }

  /** Test seam — reset the once-only warning. */
  _resetWarn(): void {
    this.warned = false;
  }
}
