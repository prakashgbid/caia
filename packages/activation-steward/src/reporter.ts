/**
 * Reporter — surfaces activation-steward findings to:
 *   1. INBOX.md  (under `## ACTIVATION-STEWARD FAILURES`)
 *   2. event-bus (3 event types)
 *   3. state-machine (via the run.completed event, picked up by the dashboard)
 *
 * Each surface is implemented as a pure function so callers can drop
 * any of them (e.g. dry-run skips INBOX + event-bus, but still computes).
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  ActivationEvent,
  ActivationEventPayload,
  AttestationCell,
  AttestationMatrix,
  RunRow,
} from './types.js';

const INBOX_HEADING = '## ACTIVATION-STEWARD FAILURES';
const INBOX_DEGRADED_HEADING = '## ACTIVATION-STEWARD DEGRADED';

// ─── INBOX append ───────────────────────────────────────────────────────────

export interface InboxAppendResult {
  readonly appended: boolean;
  readonly entriesWritten: number;
}

/**
 * Append a section under `## ACTIVATION-STEWARD FAILURES` listing every
 * red cell. If there are no red cells, this is a no-op (returns
 * `appended: false`).
 *
 * Idempotency: the steward runs hourly; we don't want to append
 * duplicate entries on every cycle. We tag each entry with the runId
 * and skip the append if the latest content of the INBOX already
 * mentions this runId.
 */
export async function reportToInbox(
  inboxPath: string,
  run: RunRow,
  matrix: AttestationMatrix,
): Promise<InboxAppendResult> {
  const reds = [...matrix.cells.values()].filter((c) => c.status === 'red');
  const degraded = run.telemetry === 'degraded';
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
  readonly events: ReadonlyArray<ActivationEvent>;
}

/**
 * Emit:
 *  - `activation-steward.run.completed`         (always, exactly once)
 *  - `activation-steward.cold-path.detected`    (once per red cell)
 *  - `activation-steward.no-telemetry.warning`  (once iff telemetry === 'absent')
 *  - `activation-steward.degraded.warning`      (once iff telemetry === 'degraded')
 *
 * Each call goes through `emit`, which is provided by the caller. We
 * don't import the conductor bus directly so this package stays
 * usable in tests without the bus's DB shim wired.
 */
export function reportToEventBus(
  emit: (event: ActivationEvent) => void,
  run: RunRow,
  matrix: AttestationMatrix,
): EventBusEmitResult {
  const events: ActivationEvent[] = [];

  const basePayload: ActivationEventPayload = {
    runId: run.runId,
    observedAt: run.finishedAt,
    site: run.site,
    telemetry: run.telemetry,
  };

  events.push({
    type: 'activation-steward.run.completed',
    payload: basePayload,
  });

  if (run.telemetry === 'absent') {
    events.push({
      type: 'activation-steward.no-telemetry.warning',
      payload: { ...basePayload, note: 'no telemetry backend reachable; skipped attestation' },
    });
  } else if (run.telemetry === 'degraded') {
    events.push({
      type: 'activation-steward.degraded.warning',
      payload: { ...basePayload, note: 'telemetry backend degraded; some cells marked unknown' },
    });
  }

  for (const cell of matrix.cells.values()) {
    if (cell.status !== 'red') continue;
    for (const r of cell.callpathResults) {
      if (r.hit) continue;
      events.push({
        type: 'activation-steward.cold-path.detected',
        payload: {
          ...basePayload,
          packageName: cell.packageName,
          tenantId: cell.tenantId,
          callpath: r.callpath.path,
          note: `expected callpath had 0 spans in last ${r.callpath.freshnessHours ?? 24}h`,
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
 * The state-machine consumes `activation-steward.run.completed` to
 * update its dashboard. This is just a thin alias over the event-bus
 * emit so callers can be explicit about intent.
 */
export function reportToStateMachine(
  emit: (event: ActivationEvent) => void,
  run: RunRow,
): void {
  emit({
    type: 'activation-steward.run.completed',
    payload: {
      runId: run.runId,
      observedAt: run.finishedAt,
      site: run.site,
      telemetry: run.telemetry,
      note: `green=${run.summary.green} yellow=${run.summary.yellow} red=${run.summary.red} no-tel=${run.summary.noTelemetry} unknown=${run.summary.unknown}`,
    },
  });
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatHeader(run: RunRow, redCount: number): string {
  return `**${run.finishedAt}** — run \`${run.runId}\` (site \`${run.site}\`, window ${run.windowHours}h) flagged **${redCount}** cold-path failure${redCount === 1 ? '' : 's'}.`;
}

function formatRedEntry(run: RunRow, cell: AttestationCell): string {
  const tenantLabel = cell.tenantId === '__no_tenant__' ? '(no tenant)' : `tenant=\`${cell.tenantId}\``;
  const cold = cell.callpathResults.filter((r) => !r.hit).map((r) => r.callpath.path);
  const list = cold.length > 0 ? cold.map((p) => `\`${p}\``).join(', ') : '(no expected paths declared)';
  return `- [ ] ${run.finishedAt} | \`${cell.packageName}\` ${tenantLabel} cold | runId=\`${run.runId}\` | hit=${cell.hitPathCount}/${cell.expectedPathCount} | cold paths: ${list}`;
}

function formatDegradedEntry(run: RunRow): string {
  return `- [ ] ${run.finishedAt} | telemetry backend degraded | runId=\`${run.runId}\` | site=\`${run.site}\``;
}

// ─── Internals ──────────────────────────────────────────────────────────────

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
