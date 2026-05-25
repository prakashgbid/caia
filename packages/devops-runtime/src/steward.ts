/**
 * @chiefaia/deploy-steward integration.
 *
 * The deploy-steward is the post-deploy verifier (a separate
 * subscription-only runtime/agent). It runs out-of-process and writes
 * verification rows to a JSONL ledger at `~/.caia/deploy-steward/runs.jsonl`.
 * The schema mirrors the existing rows on disk (sampled live during
 * package design — see PLAN.md).
 *
 * This module provides two things:
 *   1. `FileStewardClient` — production default. Appends deploy rows to
 *      the ledger and polls for the steward's `inuse_passed` + `green`
 *      fields.
 *   2. `InMemoryStewardClient` — test double. Lets tests pre-load
 *      verification verdicts that the runtime will then "discover".
 *
 * Both implementations satisfy the `StewardClient` contract from `types.ts`.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

import type {
  PollVerificationOpts,
  StewardClient,
  StewardLedgerRow,
  StewardVerification,
} from './types.js';

export const DEFAULT_STEWARD_LEDGER_PATH = join(
  homedir(),
  '.caia',
  'deploy-steward',
  'runs.jsonl',
);

export const DEFAULT_POLL_OPTS: Required<Omit<PollVerificationOpts, 'clock'>> = {
  intervalMs: 1_000,
  freshnessWindowMs: 5 * 60_000,
};

/** Tail the ledger and return the most-recent row matching `id`. */
export function findLedgerRowSync(ledgerPath: string, id: string): StewardLedgerRow | undefined {
  if (!existsSync(ledgerPath)) return undefined;
  const text = readFileSync(ledgerPath, 'utf8');
  const lines = text.split('\n');
  // Newer rows are appended at the end; iterate from the end.
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i];
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as StewardLedgerRow;
      if (parsed.id === id) return parsed;
    } catch {
      /* ignore malformed line */
    }
  }
  return undefined;
}

export class FileStewardClient implements StewardClient {
  constructor(public readonly ledgerPath: string = DEFAULT_STEWARD_LEDGER_PATH) {}

  async recordDeploy(row: StewardLedgerRow): Promise<void> {
    mkdirSync(dirname(this.ledgerPath), { recursive: true });
    appendFileSync(this.ledgerPath, JSON.stringify(row) + '\n', 'utf8');
  }

  async pollVerification(
    rowId: string,
    opts: PollVerificationOpts,
  ): Promise<StewardVerification> {
    const interval = opts.intervalMs ?? DEFAULT_POLL_OPTS.intervalMs;
    const window = opts.freshnessWindowMs ?? DEFAULT_POLL_OPTS.freshnessWindowMs;
    const now = opts.clock ?? ((): number => Date.now());
    const deadline = now() + window;
    const startedAt = now();
    while (now() < deadline) {
      const row = findLedgerRowSync(this.ledgerPath, rowId);
      if (row) {
        if (row.green && row.inuse_passed) {
          return {
            status: 'green',
            reason: row.inuse_reason || 'ok',
            row,
            durationMs: now() - startedAt,
          };
        }
        if (row.inuse_passed === false && row.inuse_reason && row.inuse_reason !== 'pending') {
          return {
            status: 'red',
            reason: row.inuse_reason,
            row,
            durationMs: now() - startedAt,
          };
        }
      }
      await sleep(interval);
    }
    const finalRow = findLedgerRowSync(this.ledgerPath, rowId);
    const stillPending = finalRow !== undefined &&
      (finalRow.inuse_reason === 'pending' || finalRow.inuse_reason === '');
    return {
      status: finalRow && !stillPending ? 'red' : 'timeout',
      reason: finalRow && !stillPending ? finalRow.inuse_reason || 'steward-verification-incomplete' : 'freshness-window-elapsed',
      ...(finalRow !== undefined ? { row: finalRow } : {}),
      durationMs: now() - startedAt,
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Test double — lets tests pre-load verdicts the runtime will see.
 *
 * Usage:
 *   const steward = new InMemoryStewardClient();
 *   steward.preload('deploy-run-1', { green: true, inuse_passed: true, inuse_reason: 'ok' });
 *   const verdict = await steward.pollVerification('deploy-run-1', {
 *     intervalMs: 1, freshnessWindowMs: 100,
 *   });
 *   // → status: 'green'
 */
export class InMemoryStewardClient implements StewardClient {
  private rows = new Map<string, StewardLedgerRow>();
  public recorded: StewardLedgerRow[] = [];

  async recordDeploy(row: StewardLedgerRow): Promise<void> {
    this.recorded.push(row);
    const existing = this.rows.get(row.id);
    if (existing) {
      // Preserve any pre-loaded inuse_* verdict; merge in the deploy_* fields.
      this.rows.set(row.id, {
        ...row,
        inuse_passed: existing.inuse_passed,
        inuse_rc: existing.inuse_rc,
        inuse_reason: existing.inuse_reason,
        inuse_duration_ms: existing.inuse_duration_ms,
        inuse_stdout: existing.inuse_stdout,
        inuse_stderr: existing.inuse_stderr,
        green: existing.green,
      });
    } else {
      this.rows.set(row.id, row);
    }
  }

  /** Preload a verdict for `id` before the runtime calls record/poll. */
  preload(id: string, verdict: Partial<StewardLedgerRow>): void {
    const row: StewardLedgerRow = {
      ts: new Date().toISOString(),
      id,
      section: 'deploys',
      kind: 'deploy',
      node_id: null,
      deploy_passed: true,
      deploy_rc: 0,
      deploy_reason: 'ok',
      deploy_duration_ms: 0,
      deploy_stdout: '',
      deploy_stderr: '',
      inuse_passed: false,
      inuse_rc: 1,
      inuse_reason: 'pending',
      inuse_duration_ms: 0,
      inuse_stdout: '',
      inuse_stderr: '',
      green: false,
      ...verdict,
    };
    this.rows.set(id, row);
  }

  async pollVerification(
    rowId: string,
    opts: PollVerificationOpts,
  ): Promise<StewardVerification> {
    const interval = opts.intervalMs ?? DEFAULT_POLL_OPTS.intervalMs;
    const window = opts.freshnessWindowMs ?? DEFAULT_POLL_OPTS.freshnessWindowMs;
    const now = opts.clock ?? ((): number => Date.now());
    const startedAt = now();
    const deadline = startedAt + window;
    while (now() < deadline) {
      const row = this.rows.get(rowId);
      if (row) {
        if (row.green && row.inuse_passed) {
          return {
            status: 'green',
            reason: row.inuse_reason || 'ok',
            row,
            durationMs: now() - startedAt,
          };
        }
        if (row.inuse_passed === false && row.inuse_reason && row.inuse_reason !== 'pending') {
          return {
            status: 'red',
            reason: row.inuse_reason,
            row,
            durationMs: now() - startedAt,
          };
        }
      }
      await sleep(Math.max(1, interval));
    }
    const final = this.rows.get(rowId);
    const stillPending = final !== undefined &&
      (final.inuse_reason === 'pending' || final.inuse_reason === '');
    return {
      status: final && !stillPending ? 'red' : 'timeout',
      reason: final && !stillPending ? final.inuse_reason || 'steward-verification-incomplete' : 'freshness-window-elapsed',
      ...(final !== undefined ? { row: final } : {}),
      durationMs: now() - startedAt,
    };
  }
}
