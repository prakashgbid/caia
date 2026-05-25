/**
 * @caia/lifecycle-conductor — INBOX reporter.
 *
 * Surfaces stuck solutions, regressions, and DoD-candidates to the
 * operator's INBOX via append-only Markdown sections. Idempotent: each
 * call records a `reportKey` and skips re-emit if the key is already
 * present in the file.
 *
 * Three headings (per canonical doc §4.4):
 *   ## LIFECYCLE-CONDUCTOR REGRESSION   — drift to degraded
 *   ## LIFECYCLE-CONDUCTOR STUCK        — solution past stuck threshold
 *   ## LIFECYCLE-CONDUCTOR DOD          — holdover started or completed
 *
 * Mirrors the activation-steward reporter's idempotency pattern: read
 * the file, check if reportKey appears, skip if so. Caller is the
 * aggregator's `onCompositeStateChanged` hook (for REGRESSION + DOD)
 * and a periodic stuck-scan on the conductor's API (for STUCK).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { LifecycleConductorApi, ListIncompleteEntry } from './api.js';
import type { CompositeStateChangedEvent, DodStatus } from './types.js';

export const HEADING_REGRESSION = '## LIFECYCLE-CONDUCTOR REGRESSION';
export const HEADING_STUCK = '## LIFECYCLE-CONDUCTOR STUCK';
export const HEADING_DOD = '## LIFECYCLE-CONDUCTOR DOD';

export interface InboxReportResult {
  appended: boolean;
  reportKey: string;
  entriesWritten: number;
}

/**
 * Append a `REGRESSION` entry to INBOX when a solution drifts to
 * `degraded`. Idempotent on `(solutionId, at)`.
 */
export async function reportRegressionToInbox(
  inboxPath: string,
  event: CompositeStateChangedEvent,
): Promise<InboxReportResult> {
  if (event.toState !== 'degraded') {
    return { appended: false, reportKey: '', entriesWritten: 0 };
  }
  const reportKey = `regression:${event.solutionId}:${event.at}`;
  const body =
    `- [ ] ${event.at} | \`${event.solutionId}\` drifted to **degraded** ` +
    `from \`${event.fromState}\` | trigger=\`${event.trigger}\` | key=\`${reportKey}\``;
  return appendIfNew(inboxPath, HEADING_REGRESSION, body, reportKey);
}

/**
 * Append a `STUCK` entry to INBOX for every solution past its
 * stuck threshold. Idempotent on `(solutionId, compositeState,
 * windowHash)` — the windowHash bumps every N hours so the entry is
 * re-surfaced if the stuck condition persists past a fresh window.
 */
export async function reportStuckToInbox(
  inboxPath: string,
  api: LifecycleConductorApi,
  opts: { thresholdHours: number; now?: Date; windowHours?: number } = {
    thresholdHours: 12,
  },
): Promise<InboxReportResult[]> {
  const incomplete = await api.listIncompleteSolutions();
  const now = opts.now ?? new Date();
  const windowHours = opts.windowHours ?? 24;
  const windowSlot = Math.floor(now.getTime() / (windowHours * 3_600_000));
  const out: InboxReportResult[] = [];
  for (const entry of incomplete) {
    if (!isStuck(entry, opts.thresholdHours)) continue;
    const reportKey = `stuck:${entry.solutionId}:${entry.compositeState}:${windowSlot}`;
    const body =
      `- [ ] ${now.toISOString()} | \`${entry.solutionId}\` stuck in ` +
      `**${entry.compositeState}** | dod-missing: ${formatMissing(entry.dod)} | ` +
      `key=\`${reportKey}\``;
    const result = await appendIfNew(inboxPath, HEADING_STUCK, body, reportKey);
    out.push(result);
  }
  return out;
}

/**
 * Append a `DOD` entry to INBOX when a solution first enters
 * `producing-metrics` (holdover started) and again when the holdover
 * completes (DoD achieved). Idempotent on `(solutionId, kind, slot)`.
 */
export async function reportDodToInbox(
  inboxPath: string,
  event: CompositeStateChangedEvent,
): Promise<InboxReportResult> {
  if (event.toState !== 'producing-metrics') {
    return { appended: false, reportKey: '', entriesWritten: 0 };
  }
  const reportKey = `dod-candidate:${event.solutionId}:${event.at}`;
  const body =
    `- [ ] ${event.at} | \`${event.solutionId}\` reached **producing-metrics** ` +
    `— 24h holdover started. key=\`${reportKey}\``;
  return appendIfNew(inboxPath, HEADING_DOD, body, reportKey);
}

/** Variant of `reportDodToInbox` for the moment the holdover completes
 * and a solution becomes DONE. Caller is the periodic DoD-scan loop
 * (run alongside the stuck-scan). */
export async function reportDodCompletedToInbox(
  inboxPath: string,
  dod: DodStatus,
): Promise<InboxReportResult> {
  if (!dod.done) {
    return { appended: false, reportKey: '', entriesWritten: 0 };
  }
  const reportKey = `dod-complete:${dod.solutionId}`;
  const body =
    `- [x] \`${dod.solutionId}\` has met the Real DoD — all five stewards green ` +
    `for ≥24h consecutive. key=\`${reportKey}\``;
  return appendIfNew(inboxPath, HEADING_DOD, body, reportKey);
}

// ─── Internals ──────────────────────────────────────────────────────────────

async function appendIfNew(
  inboxPath: string,
  heading: string,
  body: string,
  reportKey: string,
): Promise<InboxReportResult> {
  await fs.mkdir(path.dirname(inboxPath), { recursive: true });
  let existing: string;
  try {
    existing = await fs.readFile(inboxPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) existing = '';
    else throw err;
  }
  if (existing.includes(reportKey)) {
    return { appended: false, reportKey, entriesWritten: 0 };
  }
  const lines: string[] = [];
  if (!existing.endsWith('\n') && existing.length > 0) lines.push('');
  lines.push('');
  if (!existing.includes(heading)) {
    lines.push(heading);
    lines.push('');
  }
  lines.push(body);
  lines.push('');
  await fs.appendFile(inboxPath, lines.join('\n'), 'utf8');
  return { appended: true, reportKey, entriesWritten: 1 };
}

function isStuck(entry: ListIncompleteEntry, thresholdHours: number): boolean {
  // Composite-state-driven heuristic. The aggregator tracks
  // producing-metrics-since but not per-other-state since, so we use:
  //  - degraded: always considered stuck (operator must intervene).
  //  - producing-metrics with ageHoursInState < holdover: not stuck.
  //  - all other forward states: stuck if entry.ageHoursInState >=
  //    threshold (only known for producing-metrics in v1; null else).
  if (entry.compositeState === 'degraded') return true;
  if (entry.compositeState === 'producing-metrics') {
    // Inside holdover: not stuck. Past holdover + still not DONE means
    // there's drift — already a separate REGRESSION entry, skip here.
    return false;
  }
  if (entry.ageHoursInState === null) return false;
  return entry.ageHoursInState >= thresholdHours;
}

function formatMissing(dod: DodStatus): string {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(dod.missing)) {
    parts.push(`${k}=${v}`);
  }
  if (dod.driftDuringHoldover) parts.push('drift-during-holdover');
  return parts.length > 0 ? parts.join(',') : '(none)';
}

function isNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    (err as { code?: string }).code === 'ENOENT'
  );
}
