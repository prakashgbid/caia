// DoD v2 Guardrail #10 — adoption-everywhere gate.
//
// Companion: reports/dod_v2_guardrail_10_adoption_everywhere_2026-05-16.md (PR #492).
// Companion: agent-memory/decisions/p3_adoption_enforcement_substrate_2026_05_16.md.
//
// Sits next to gate-mark-done.sh: G2 checks "open PR for the chain's branch?",
// G10 checks "any adoption opportunity for the chain's deliverable still
// pending?". Same chokepoint (caia-chain mark-done), different question.
//
// V1 scope (this phase): the programmatic gate + tests. The shell wiring
// (gate-mark-done.sh extension + mark-done --adoption-pending-ok flag) and
// the audit-event emission land in phase 2.
//
// Lifecycle states the gate sees (from substrate §5):
//   discovered -> proposed -> opened -> verifying -> verified -> merged | failed | deferred | dropped
//
// Pass set (G10 §1 of the addendum):    {merged, deferred}
// Block set (explicit per addendum):    {discovered, proposed, opened, verifying, failed, dropped}
// Stuck-opened: state=opened AND (now - opened_at) > 14d -> block (independent of pass/block set).
//
// 'verified' is the only transitional state not in either set. Treat it as
// block (conservative — substrate v1 produces 'merged' once the adoption PR
// lands; 'verified' is an in-flight state and a chain should not be 'done'
// while opportunities are still in verification).
//
// Empty ledger -> {ok:true, blockers:[]}. This is the v1 no-op mode that lets
// the gate ship before scan/xref/generate populate the ledger (addendum §6).

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

/**
 * Pass states. An opportunity in one of these does NOT block the gate.
 */
export const ADOPTION_PASS_STATES = new Set<string>(['merged', 'deferred']);

/**
 * Block states explicitly listed in the addendum. Any state not in
 * ADOPTION_PASS_STATES also blocks (defensive default), but these are the
 * states we expect to see and surface with their own reason.
 */
export const ADOPTION_BLOCK_STATES = new Set<string>([
  'discovered',
  'proposed',
  'opened',
  'verifying',
  'failed',
  'dropped',
]);

/**
 * Default age threshold for the stuck-opened check. Opportunities that have
 * been in `opened` state longer than this without progressing are blockers
 * even though `opened` is already in the block set — the separate reason
 * makes operator triage easier.
 */
export const DEFAULT_STUCK_OPENED_DAYS = 14;

export interface CheckAdoptionGateOptions {
  /** Override ledger path. Defaults to <home>/.caia/adoption/ledger.jsonl. */
  ledgerPath?: string;
  /** Override $HOME (test injection). Ignored when ledgerPath is set. */
  homeDir?: string;
  /** Override "now" for deterministic stuck-opened tests. Defaults to Date(). */
  now?: Date;
  /** Override the stuck-opened threshold. */
  stuckOpenedDays?: number;
}

export type BlockerReason = 'pending_state' | 'stuck_opened' | 'unknown_state';

export interface AdoptionGateBlocker {
  /** Stable id from the ledger row if present (substrate emits one). */
  opportunity_id?: string;
  /** Lifecycle state observed. */
  state: string;
  /** Why this row blocks. */
  reason: BlockerReason;
  /** Diagnostic fields, copied through best-effort. */
  target_utility?: string;
  target_export?: string;
  call_site_file?: string;
  call_site_line?: number;
  /** ISO timestamp when state moved to `opened` (for stuck-opened). */
  opened_at?: string;
  /** Age in days at gate-check time (only set for stuck-opened). */
  age_days?: number;
}

export interface AdoptionGateResult {
  /** True when no row blocks the chain from being marked done. */
  ok: boolean;
  /** One entry per blocking ledger row, in ledger-file order. */
  blockers: AdoptionGateBlocker[];
  /** Total rows in the ledger matching this chain_id. */
  total_rows: number;
  /** Rows in ADOPTION_PASS_STATES (merged/deferred). */
  passing_rows: number;
  /** Absolute path the gate actually consulted. */
  ledger_path: string;
  /** True when the ledger file did not exist or was empty. */
  empty_ledger: boolean;
  /** Lines that failed to parse — surfaced for operator visibility. */
  malformed_lines: number;
}

interface LedgerRow {
  chain_id?: string;
  state?: string;
  opportunity_id?: string;
  target_utility?: string;
  target_export?: string;
  call_site_file?: string;
  call_site_line?: number;
  opened_at?: string;
  [k: string]: unknown;
}

function defaultLedgerPath(opts: CheckAdoptionGateOptions): string {
  if (opts.ledgerPath) return opts.ledgerPath;
  const home = opts.homeDir ?? homedir();
  return join(home, '.caia', 'adoption', 'ledger.jsonl');
}

function parseLedger(
  path: string,
): { rows: LedgerRow[]; malformed: number } {
  if (!existsSync(path)) return { rows: [], malformed: 0 };
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch {
    return { rows: [], malformed: 0 };
  }
  if (raw.length === 0) return { rows: [], malformed: 0 };
  const rows: LedgerRow[] = [];
  let malformed = 0;
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    try {
      const parsed = JSON.parse(trimmed) as unknown;
      if (parsed && typeof parsed === 'object') {
        rows.push(parsed as LedgerRow);
      } else {
        malformed += 1;
      }
    } catch {
      malformed += 1;
    }
  }
  return { rows, malformed };
}

function ageDays(openedAt: string, now: Date): number | null {
  const t = Date.parse(openedAt);
  if (Number.isNaN(t)) return null;
  return (now.getTime() - t) / (1000 * 60 * 60 * 24);
}

function rowToBlocker(
  row: LedgerRow,
  reason: BlockerReason,
  ageDaysVal?: number,
): AdoptionGateBlocker {
  const b: AdoptionGateBlocker = {
    state: typeof row.state === 'string' ? row.state : '<missing>',
    reason,
  };
  if (typeof row.opportunity_id === 'string') b.opportunity_id = row.opportunity_id;
  if (typeof row.target_utility === 'string') b.target_utility = row.target_utility;
  if (typeof row.target_export === 'string') b.target_export = row.target_export;
  if (typeof row.call_site_file === 'string') b.call_site_file = row.call_site_file;
  if (typeof row.call_site_line === 'number') b.call_site_line = row.call_site_line;
  if (typeof row.opened_at === 'string') b.opened_at = row.opened_at;
  if (ageDaysVal !== undefined) b.age_days = ageDaysVal;
  return b;
}

/**
 * Check whether the given chain is clear to be marked done w.r.t. the
 * adoption-everywhere guardrail.
 *
 * Empty / missing ledger -> ok=true (v1 no-op mode). This is intentional:
 * the gate ships before the scan/xref/generate substrate, and an empty
 * ledger means "we have no opportunities recorded, therefore none to block
 * on" rather than "the substrate is broken." Operator-facing observability
 * for "no rows for any chain in N days" lives outside this function.
 *
 * Pass criteria (per addendum §1):
 *   - every row for this chain_id is in {merged, deferred}
 *   - AND no row in 'opened' state is older than stuckOpenedDays.
 */
export function checkAdoptionGate(
  chainId: string,
  opts: CheckAdoptionGateOptions = {},
): AdoptionGateResult {
  if (typeof chainId !== 'string' || chainId.length === 0) {
    throw new Error('checkAdoptionGate: chainId is required');
  }

  const ledger_path = defaultLedgerPath(opts);
  const { rows, malformed } = parseLedger(ledger_path);
  const now = opts.now ?? new Date();
  const stuckDays = opts.stuckOpenedDays ?? DEFAULT_STUCK_OPENED_DAYS;

  const myRows = rows.filter((r) => r.chain_id === chainId);

  if (myRows.length === 0) {
    return {
      ok: true,
      blockers: [],
      total_rows: 0,
      passing_rows: 0,
      ledger_path,
      empty_ledger: rows.length === 0,
      malformed_lines: malformed,
    };
  }

  const blockers: AdoptionGateBlocker[] = [];
  let passing = 0;

  for (const row of myRows) {
    const state = typeof row.state === 'string' ? row.state : '';

    if (ADOPTION_PASS_STATES.has(state)) {
      passing += 1;
      continue;
    }

    if (state === 'opened' && typeof row.opened_at === 'string') {
      const age = ageDays(row.opened_at, now);
      if (age !== null && age > stuckDays) {
        blockers.push(rowToBlocker(row, 'stuck_opened', age));
        continue;
      }
    }

    if (ADOPTION_BLOCK_STATES.has(state)) {
      blockers.push(rowToBlocker(row, 'pending_state'));
      continue;
    }

    // Defensive: any state outside the pass + known-block sets (including
    // 'verified' and any future state) blocks until promoted. Keeps the gate
    // safe under substrate schema drift.
    blockers.push(rowToBlocker(row, 'unknown_state'));
  }

  return {
    ok: blockers.length === 0,
    blockers,
    total_rows: myRows.length,
    passing_rows: passing,
    ledger_path,
    empty_ledger: false,
    malformed_lines: malformed,
  };
}
