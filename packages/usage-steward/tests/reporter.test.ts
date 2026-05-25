import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRunRow } from '../src/attestation.js';
import { buildAttestationMatrix } from '../src/manifest-cross-check.js';
import { reportToEventBus, reportToInbox, reportToStateMachine } from '../src/reporter.js';
import type {
  AttestationCell, CrossCheckObservation, ScannerKind, ScannerToolingState, UsageEvent,
} from '../src/types.js';

let TMP: string;
beforeEach(async () => { TMP = await fs.mkdtemp(path.join(os.tmpdir(), 'us-rep-')); });
afterEach(async () => { await fs.rm(TMP, { recursive: true, force: true }); });

const presentAll: Record<ScannerKind, ScannerToolingState> = {
  knip: 'present', depcheck: 'present', 'ts-prune': 'present', 'dependency-cruiser': 'present',
};
const failedKnip: Record<ScannerKind, ScannerToolingState> = {
  ...presentAll, knip: 'failed',
};
const absentAll: Record<ScannerKind, ScannerToolingState> = {
  knip: 'absent', depcheck: 'absent', 'ts-prune': 'absent', 'dependency-cruiser': 'absent',
};

function obs(kind: CrossCheckObservation['observationKind'], sev: 'error'|'warn'|'info' = 'error'): CrossCheckObservation {
  return { packageName: 'a', observationKind: kind, severity: sev, detail: 'detail', supportingFindings: [] };
}
function cell(name: string, status: AttestationCell['status'] = 'green', extras: Partial<AttestationCell> = {}): AttestationCell {
  return {
    packageName: name, solutionId: null, status,
    expectedImportCount: 0, satisfiedImportCount: 0,
    expectedExportCount: 0, reachableExportCount: 0,
    orphanCount: 0, unusedDepCount: 0, missingDepCount: 0, circularDepCount: 0,
    scannerStates: presentAll, observations: [], ...extras,
  };
}
function mkRow(cells: AttestationCell[], scannerStates = presentAll) {
  const matrix = buildAttestationMatrix(cells);
  const row = buildRunRow({
    runId: 'r-1', startedAt: new Date('2026-05-25T00:00:00Z'),
    finishedAt: new Date('2026-05-25T00:00:01Z'),
    site: 'caia-mac', packagesRoot: '/r', scannerStates, matrix,
  });
  return { row, matrix };
}

describe('reportToInbox', () => {
  it('no-ops when no red cells and no degraded scanners', async () => {
    const { row, matrix } = mkRow([cell('a','green')]);
    const p = path.join(TMP,'INBOX.md');
    const r = await reportToInbox(p, row, matrix);
    expect(r.appended).toBe(false);
  });
  it('writes a section under ## USAGE-STEWARD FAILURE for red cells', async () => {
    const { row, matrix } = mkRow([cell('a','red', { observations: [obs('declared-import-missing','error')] })]);
    const p = path.join(TMP,'INBOX.md');
    await reportToInbox(p, row, matrix);
    const text = await fs.readFile(p, 'utf8');
    expect(text).toContain('## USAGE-STEWARD FAILURE');
    expect(text).toContain('r-1');
    expect(text).toContain('`a`');
  });
  it('is idempotent — re-running with same runId does not re-append', async () => {
    const { row, matrix } = mkRow([cell('a','red', { observations: [obs('undeclared-orphan','error')] })]);
    const p = path.join(TMP,'INBOX.md');
    await reportToInbox(p, row, matrix);
    const first = await fs.readFile(p, 'utf8');
    await reportToInbox(p, row, matrix);
    const second = await fs.readFile(p, 'utf8');
    expect(second).toBe(first);
  });
  it('writes a degraded section when a scanner failed even with no reds', async () => {
    const { row, matrix } = mkRow([cell('a','green')], failedKnip);
    const p = path.join(TMP,'INBOX.md');
    const r = await reportToInbox(p, row, matrix);
    expect(r.appended).toBe(true);
    const text = await fs.readFile(p, 'utf8');
    expect(text).toContain('## USAGE-STEWARD DEGRADED');
    expect(text).toContain('knip');
  });
});

describe('reportToEventBus', () => {
  it('always emits run.completed', () => {
    const emitted: UsageEvent[] = [];
    const { row, matrix } = mkRow([cell('a','green')]);
    const r = reportToEventBus((e) => emitted.push(e), row, matrix);
    expect(r.events[0]?.type).toBe('usage-steward.run.completed');
    expect(emitted.length).toBe(r.events.length);
  });
  it('emits no-tooling.warning when every scanner is absent', () => {
    const emitted: UsageEvent[] = [];
    const { row, matrix } = mkRow([cell('a','no-tooling')], absentAll);
    reportToEventBus((e) => emitted.push(e), row, matrix);
    expect(emitted.some((e) => e.type === 'usage-steward.no-tooling.warning')).toBe(true);
  });
  it('emits scanner.degraded for each failed scanner', () => {
    const emitted: UsageEvent[] = [];
    const { row, matrix } = mkRow([cell('a','green')], failedKnip);
    reportToEventBus((e) => emitted.push(e), row, matrix);
    expect(emitted.filter((e) => e.type === 'usage-steward.scanner.degraded')).toHaveLength(1);
  });
  it('emits declared-import.missing for red cells with that observation', () => {
    const emitted: UsageEvent[] = [];
    const c = cell('a','red', { observations: [obs('declared-import-missing','error')] });
    const { row, matrix } = mkRow([c]);
    reportToEventBus((e) => emitted.push(e), row, matrix);
    expect(emitted.some((e) => e.type === 'usage-steward.declared-import.missing')).toBe(true);
  });
  it('never throws if the emit callback throws', () => {
    const { row, matrix } = mkRow([cell('a','green')]);
    expect(() => reportToEventBus(() => { throw new Error('boom'); }, row, matrix)).not.toThrow();
  });
});

describe('reportToStateMachine', () => {
  it('emits a single run.completed event with summary counts in note', () => {
    const emitted: UsageEvent[] = [];
    const { row } = mkRow([cell('a','green'), cell('b','red')]);
    reportToStateMachine((e) => emitted.push(e), row);
    expect(emitted).toHaveLength(1);
    expect(emitted[0]?.type).toBe('usage-steward.run.completed');
    expect(emitted[0]?.payload.note).toContain('green=');
  });
});
