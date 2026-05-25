/**
 * Reporter — surfaces usage-steward findings to:
 *   1. INBOX.md (under `## USAGE-STEWARD FAILURE`)
 *   2. event-bus (5 event types)
 *   3. state-machine (via run.completed event, picked up by the dashboard)
 *
 * Each surface is a pure function so callers can drop any (dry-run
 * skips INBOX + bus, still computes the matrix).
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import type {
  AttestationCell, AttestationMatrix, RunRow,
  UsageEvent, UsageEventPayload,
} from './types.js';

const INBOX_HEADING = '## USAGE-STEWARD FAILURE';
const INBOX_DEGRADED_HEADING = '## USAGE-STEWARD DEGRADED';

export interface InboxAppendResult {
  readonly appended: boolean;
  readonly entriesWritten: number;
}

/**
 * Append a section under `## USAGE-STEWARD FAILURE` listing every red
 * cell. No-op when nothing is red AND nothing is degraded. Idempotent:
 * skips if the INBOX already mentions this runId.
 */
export async function reportToInbox(
  inboxPath: string,
  run: RunRow,
  matrix: AttestationMatrix,
): Promise<InboxAppendResult> {
  const reds = [...matrix.cells.values()].filter((c) => c.status === 'red');
  const degraded = degradedScanners(run);
  if (reds.length === 0 && degraded.length === 0) {
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
    for (const cell of reds) lines.push(formatRedEntry(run, cell));
    lines.push('');
  }
  if (degraded.length > 0) {
    lines.push(INBOX_DEGRADED_HEADING);
    lines.push('');
    lines.push(formatDegradedEntry(run, degraded));
    lines.push('');
  }
  await fs.appendFile(inboxPath, lines.join('\n'), 'utf8');
  return { appended: true, entriesWritten: reds.length + (degraded.length > 0 ? 1 : 0) };
}

export interface EventBusEmitResult {
  readonly eventsEmitted: number;
  readonly events: ReadonlyArray<UsageEvent>;
}

/**
 * Emit:
 *   - usage-steward.run.completed              (always, once)
 *   - usage-steward.orphan.detected            (once per red orphan cell)
 *   - usage-steward.declared-import.missing    (once per declared-import-missing observation)
 *   - usage-steward.scanner.degraded           (once per failed scanner)
 *   - usage-steward.no-tooling.warning         (once iff every scanner is absent)
 */
export function reportToEventBus(
  emit: (event: UsageEvent) => void,
  run: RunRow,
  matrix: AttestationMatrix,
): EventBusEmitResult {
  const events: UsageEvent[] = [];
  const base: UsageEventPayload = {
    runId: run.runId, observedAt: run.finishedAt, site: run.site,
  };

  events.push({ type: 'usage-steward.run.completed', payload: base });

  const anyPresent = Object.values(run.scannerStates).some((s) => s === 'present');
  if (!anyPresent) {
    events.push({
      type: 'usage-steward.no-tooling.warning',
      payload: { ...base, note: 'no scanner binaries on PATH; cells all degraded' },
    });
  }
  for (const [scanner, state] of Object.entries(run.scannerStates)) {
    if (state === 'failed') {
      events.push({
        type: 'usage-steward.scanner.degraded',
        payload: { ...base, scanner: scanner as Exclude<UsageEvent['payload']['scanner'], undefined>, note: `${scanner} run errored; cell unknown` },
      });
    }
  }

  for (const cell of matrix.cells.values()) {
    if (cell.status !== 'red') continue;
    for (const obs of cell.observations) {
      if (obs.observationKind === 'declared-import-missing') {
        events.push({
          type: 'usage-steward.declared-import.missing',
          payload: { ...base, packageName: cell.packageName, detail: obs.detail },
        });
      }
      if (obs.observationKind === 'undeclared-orphan' && obs.severity === 'error') {
        events.push({
          type: 'usage-steward.orphan.detected',
          payload: { ...base, packageName: cell.packageName, detail: obs.detail },
        });
      }
    }
  }

  for (const ev of events) {
    try { emit(ev); } catch { /* never crash run loop on flaky bus */ }
  }
  return { eventsEmitted: events.length, events };
}

/**
 * State-machine event surface. The state-machine consumes
 * `usage-steward.run.completed` to update its dashboard. Thin alias
 * over the event-bus emit for explicit intent.
 */
export function reportToStateMachine(
  emit: (event: UsageEvent) => void,
  run: RunRow,
): void {
  emit({
    type: 'usage-steward.run.completed',
    payload: {
      runId: run.runId,
      observedAt: run.finishedAt,
      site: run.site,
      note: `green=${run.summary.green} yellow=${run.summary.yellow} red=${run.summary.red} no-tooling=${run.summary.noTooling} unknown=${run.summary.unknown}`,
    },
  });
}

// ─── Formatters ─────────────────────────────────────────────────────────────

function formatHeader(run: RunRow, redCount: number): string {
  return `**${run.finishedAt}** — run \`${run.runId}\` (site \`${run.site}\`) flagged **${redCount}** dead-code attestation${redCount === 1 ? '' : 's'}.`;
}

function formatRedEntry(run: RunRow, cell: AttestationCell): string {
  const sym = `\`${cell.packageName}\``;
  const detail = topObservationDetail(cell);
  return `- [ ] ${run.finishedAt} | ${sym} red | runId=\`${run.runId}\` | orphans=${cell.orphanCount} unusedDeps=${cell.unusedDepCount} missingDeps=${cell.missingDepCount} circular=${cell.circularDepCount} | ${detail}`;
}

function topObservationDetail(cell: AttestationCell): string {
  const err = cell.observations.find((o) => o.severity === 'error');
  if (err) return err.detail;
  return cell.observations[0]?.detail ?? '(no observations)';
}

function formatDegradedEntry(run: RunRow, scanners: ReadonlyArray<string>): string {
  return `- [ ] ${run.finishedAt} | scanners degraded: ${scanners.map((s) => '`' + s + '`').join(', ')} | runId=\`${run.runId}\` | site=\`${run.site}\``;
}

function degradedScanners(run: RunRow): ReadonlyArray<string> {
  return Object.entries(run.scannerStates)
    .filter(([, s]) => s === 'failed')
    .map(([k]) => k);
}

function isNotFound(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as { code?: string }).code === 'ENOENT';
}
