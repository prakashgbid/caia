/**
 * Reporter — surfaces outcome-steward findings to:
 *   1. INBOX.md  (under `## OUTCOME-STEWARD FAILURES`)
 *   2. event-bus (8 event types per spec §4.3)
 *   3. state-machine (via `outcome-steward.run.completed`, picked up by the dashboard)
 *
 * Each surface is implemented as a pure function so callers can drop
 * any of them (e.g. dry-run skips INBOX + event-bus, but still computes).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  AttestationCell,
  AttestationMatrix,
  GreenAttestation,
  OutcomeEvent,
  OutcomeEventPayload,
  RunRow,
} from './types.js';

const INBOX_HEADING = '## OUTCOME-STEWARD FAILURES';
const INBOX_DEGRADED_HEADING = '## OUTCOME-STEWARD DEGRADED';

// ─── INBOX append ───────────────────────────────────────────────────────────

export interface InboxAppendResult {
  readonly appended: boolean;
  readonly entriesWritten: number;
}

/**
 * Append a section under `## OUTCOME-STEWARD FAILURES` listing every
 * red cell. If there are no red cells AND the backend isn't degraded,
 * this is a no-op (returns `appended: false`).
 *
 * Idempotency: tags each entry with the runId; skips append if the
 * INBOX already mentions this runId.
 */
export async function reportToInbox(
  inboxPath: string,
  run: RunRow,
  matrix: AttestationMatrix,
): Promise<InboxAppendResult> {
  const reds = [...matrix.cells.values()].filter((c) => c.status === 'red');
  const degraded = run.backend === 'degraded';
  if (reds.length === 0 && !degraded) {
    return { appended: false, entriesWritten: 0 };
  }

  await fs.mkdir(path.dirname(inboxPath), { recursive: true });
  let existing: string;
  try {
    existing = await fs.readFile(inboxPath, 'utf8');
  } catch (err) {
    if (isNotFound(err)) existing = '';
    else throw err;
  }

  // Idempotency: skip if this runId already recorded.
  if (existing.includes(run.runId)) {
    return { appended: false, entriesWritten: 0 };
  }

  const lines: string[] = [];
  if (!existing.endsWith('\n') && existing.length > 0) lines.push('');
  lines.push('');

  if (reds.length > 0) {
    lines.push(INBOX_HEADING);
    lines.push('');
    lines.push(formatHeader(run, reds.length));
    lines.push('');
    for (const cell of reds) {
      lines.push(formatRedEntry(run, cell));
    }
    lines.push('');
  }
  if (degraded) {
    lines.push(INBOX_DEGRADED_HEADING);
    lines.push('');
    lines.push(formatDegradedEntry(run));
    lines.push('');
  }

  await fs.appendFile(inboxPath, lines.join('\n'), 'utf8');
  return { appended: true, entriesWritten: reds.length + (degraded ? 1 : 0) };
}

// ─── Event-bus emit ─────────────────────────────────────────────────────────

export interface EventBusEmitResult {
  readonly eventsEmitted: number;
  readonly events: ReadonlyArray<OutcomeEvent>;
}

/**
 * Emit the 8 event types per spec §4.3.
 *
 * Each call goes through `emit`, which is provided by the caller. We
 * don't import the conductor bus directly so this package stays
 * usable in tests without the bus's DB shim wired.
 */
export function reportToEventBus(
  emit: (event: OutcomeEvent) => void,
  run: RunRow,
  matrix: AttestationMatrix,
): EventBusEmitResult {
  const events: OutcomeEvent[] = [];

  const basePayload: OutcomeEventPayload = {
    runId: run.runId,
    observedAt: run.finishedAt,
    site: run.site,
    backend: run.backend,
  };

  // Always: run.completed.
  events.push({ type: 'outcome-steward.run.completed', payload: basePayload });

  // Backend state warnings (once each, at most).
  if (run.backend === 'absent') {
    events.push({
      type: 'outcome-steward.no-metric-store.warning',
      payload: { ...basePayload, note: 'no metric backend reachable; skipped attestation' },
    });
  } else if (run.backend === 'degraded') {
    events.push({
      type: 'outcome-steward.degraded.warning',
      payload: { ...basePayload, note: 'metric backend degraded; some cells marked unknown' },
    });
  }

  // Per-cell events.
  for (const cell of matrix.cells.values()) {
    const cellPayload: OutcomeEventPayload = {
      ...basePayload,
      packageName: cell.packageName,
      solutionId: cell.solutionId,
      sliMetric: cell.sliMetric,
      latestValue: cell.latestValue,
      threshold: cell.threshold,
      direction: cell.direction,
      trend: cell.trend,
    };

    if (cell.status === 'green') {
      events.push({ type: 'outcome-steward.attestation.green', payload: cellPayload });
      continue;
    }
    if (cell.status === 'yellow') {
      events.push({ type: 'outcome-steward.attestation.yellow', payload: cellPayload });
    }
    if (cell.status === 'red') {
      events.push({ type: 'outcome-steward.attestation.red', payload: cellPayload });
      // Differentiate: is this red because the metric is missing entirely?
      if (cell.result && !cell.result.metricPresent) {
        events.push({
          type: 'outcome-steward.cold-metric.detected',
          payload: { ...cellPayload, note: `expected SLI had 0 samples in last ${run.windowHours}h` },
        });
      }
    }
    // Trend violation (orthogonal to red — fires for yellows whose
    // threshold is satisfied but trend is wrong).
    if (
      cell.result &&
      cell.result.metricPresent &&
      cell.result.thresholdSatisfied &&
      !cell.result.trendSatisfied
    ) {
      events.push({
        type: 'outcome-steward.trend-violation.detected',
        payload: {
          ...cellPayload,
          note: `trend ${cell.trend} does not match declared ${cell.result.sli.trendDirection ?? 'any'}`,
        },
      });
    }
  }

  for (const ev of events) {
    try {
      emit(ev);
    } catch {
      // never crash the run loop on a flaky bus
    }
  }

  return { eventsEmitted: events.length, events };
}

// ─── State-machine dashboard surface ────────────────────────────────────────

/**
 * The state-machine consumes `outcome-steward.run.completed` to update
 * its dashboard. Thin alias over the event-bus emit so callers can be
 * explicit about intent.
 */
export function reportToStateMachine(
  emit: (event: OutcomeEvent) => void,
  run: RunRow,
): void {
  emit({
    type: 'outcome-steward.run.completed',
    payload: {
      runId: run.runId,
      observedAt: run.finishedAt,
      site: run.site,
      backend: run.backend,
      note:
        `green=${run.summary.green} yellow=${run.summary.yellow} red=${run.summary.red} ` +
        `no-metric-declared=${run.summary.noMetricDeclared} no-metric-store=${run.summary.noMetricStore} unknown=${run.summary.unknown}`,
    },
  });
}

/**
 * Pretty-print the green-attestation roll-up for logs.
 */
export function summariseGreenAttestations(green: ReadonlyArray<GreenAttestation>): string {
  if (green.length === 0) return 'no green attestations';
  const bySolution = new Map<string, number>();
  for (const g of green) {
    bySolution.set(g.solutionId, (bySolution.get(g.solutionId) ?? 0) + 1);
  }
  const parts: string[] = [];
  for (const [solutionId, n] of [...bySolution.entries()].sort()) {
    parts.push(`${solutionId}=${n}`);
  }
  return parts.join(', ');
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatHeader(run: RunRow, redCount: number): string {
  return (
    `**${run.finishedAt}** — run \`${run.runId}\` (site \`${run.site}\`, window ${run.windowHours}h) ` +
    `flagged **${redCount}** SLI failure${redCount === 1 ? '' : 's'}.`
  );
}

function formatRedEntry(run: RunRow, cell: AttestationCell): string {
  const value =
    cell.latestValue === null ? 'absent' : `value=${cell.latestValue}`;
  const trend = cell.trend === 'unknown' ? 'trend=unknown' : `trend=${cell.trend}`;
  return (
    `- [ ] ${run.finishedAt} | \`${cell.packageName}\` solution=\`${cell.solutionId}\` ` +
    `sli=\`${cell.sliMetric}\` red | runId=\`${run.runId}\` | ${value} threshold ${cell.direction} ${cell.threshold} | ${trend}`
  );
}

function formatDegradedEntry(run: RunRow): string {
  return `- [ ] ${run.finishedAt} | metric backend degraded | runId=\`${run.runId}\` | site=\`${run.site}\``;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
