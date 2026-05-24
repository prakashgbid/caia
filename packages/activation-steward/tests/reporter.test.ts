import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRunRow } from '../src/attestation.js';
import { buildAttestationMatrix } from '../src/per-tenant-isolation.js';
import {
  reportToEventBus,
  reportToInbox,
  reportToStateMachine,
} from '../src/reporter.js';
import type {
  ActivationEvent,
  CrossCheckResult,
  ExpectedCallPath,
  PackageExpectations,
} from '../src/types.js';

function cp(overrides: Partial<ExpectedCallPath> = {}): ExpectedCallPath {
  return { path: 'p', serviceName: 's', spanName: 'p', freshnessHours: 24, optional: false, ...overrides };
}

function pkg(name: string, paths: ExpectedCallPath[]): PackageExpectations {
  return { packageName: name, source: 'package.json', expectedCallPaths: paths };
}

function result(overrides: Partial<CrossCheckResult> = {}): CrossCheckResult {
  return {
    packageName: '@caia/x',
    tenantId: 't1',
    callpath: cp(),
    spanCount: 0,
    traceCount: 0,
    mostRecentAt: null,
    hit: false,
    ...overrides,
  };
}

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'activation-steward-rep-'));
}

describe('reportToInbox', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('no-ops when there are no red cells and telemetry is present', async () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })])];
    const matrix = buildAttestationMatrix(
      [result({ callpath: cp({ path: 'A' }), hit: true })],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const out = await reportToInbox(path.join(dir, 'INBOX.md'), row, matrix);
    expect(out.appended).toBe(false);
  });

  it('writes the failures heading + one entry per red cell', async () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })])];
    const matrix = buildAttestationMatrix(
      [result({ callpath: cp({ path: 'A' }), hit: false })],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      startedAt: new Date('2026-05-24T18:00:00Z'),
      finishedAt: new Date('2026-05-24T18:00:01Z'),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const inboxPath = path.join(dir, 'INBOX.md');
    const out = await reportToInbox(inboxPath, row, matrix);
    expect(out.appended).toBe(true);
    const text = await fs.readFile(inboxPath, 'utf8');
    expect(text).toContain('## ACTIVATION-STEWARD FAILURES');
    expect(text).toContain(row.runId);
    expect(text).toContain('`@caia/x`');
  });

  it('is idempotent across multiple calls with the same runId', async () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' })])];
    const matrix = buildAttestationMatrix(
      [result({ callpath: cp({ path: 'A' }), hit: false })],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      runId: 'actrun_dedup',
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const inboxPath = path.join(dir, 'INBOX.md');
    await reportToInbox(inboxPath, row, matrix);
    const second = await reportToInbox(inboxPath, row, matrix);
    expect(second.appended).toBe(false);
    const sizeAfterFirst = (await fs.stat(inboxPath)).size;
    const sizeAfterSecond = (await fs.stat(inboxPath)).size;
    expect(sizeAfterSecond).toBe(sizeAfterFirst);
    // The header line + each entry line both reference the runId, so >=1 occurrence.
    const text = await fs.readFile(inboxPath, 'utf8');
    const occurrences = (text.match(/actrun_dedup/g) ?? []).length;
    expect(occurrences).toBeGreaterThanOrEqual(1);
    // Idempotency: the first call appended (>=1 reference), the second did not
    // increase the count — so it must equal the first-pass count (2: header + entry).
    expect(occurrences).toBe(2);
  });

  it('writes the degraded heading when telemetry is degraded', async () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'degraded', packages: [] });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'degraded', windowHours: 24, matrix,
    });
    const inboxPath = path.join(dir, 'INBOX.md');
    const out = await reportToInbox(inboxPath, row, matrix);
    expect(out.appended).toBe(true);
    const text = await fs.readFile(inboxPath, 'utf8');
    expect(text).toContain('## ACTIVATION-STEWARD DEGRADED');
  });
});

describe('reportToEventBus', () => {
  it('always emits exactly one run.completed event', () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages: [] });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const sink: ActivationEvent[] = [];
    const out = reportToEventBus((e) => sink.push(e), row, matrix);
    expect(out.eventsEmitted).toBe(1);
    expect(sink[0]!.type).toBe('activation-steward.run.completed');
  });

  it('emits no-telemetry.warning when telemetry is absent', () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'absent', packages: [] });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'absent', windowHours: 24, matrix,
    });
    const sink: ActivationEvent[] = [];
    reportToEventBus((e) => sink.push(e), row, matrix);
    expect(sink.map((e) => e.type)).toContain('activation-steward.no-telemetry.warning');
  });

  it('emits degraded.warning when telemetry is degraded', () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'degraded', packages: [] });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'degraded', windowHours: 24, matrix,
    });
    const sink: ActivationEvent[] = [];
    reportToEventBus((e) => sink.push(e), row, matrix);
    expect(sink.map((e) => e.type)).toContain('activation-steward.degraded.warning');
  });

  it('emits one cold-path.detected event per red callpath', () => {
    const packages = [pkg('@caia/x', [cp({ path: 'A' }), cp({ path: 'B' })])];
    const matrix = buildAttestationMatrix(
      [
        result({ callpath: cp({ path: 'A' }), hit: false }),
        result({ callpath: cp({ path: 'B' }), hit: false }),
      ],
      { telemetry: 'present', packages },
    );
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    const sink: ActivationEvent[] = [];
    reportToEventBus((e) => sink.push(e), row, matrix);
    const cold = sink.filter((e) => e.type === 'activation-steward.cold-path.detected');
    expect(cold).toHaveLength(2);
    expect(cold.map((e) => e.payload.callpath).sort()).toEqual(['A', 'B']);
  });

  it('does not throw when emit throws', () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages: [] });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'x', telemetry: 'present', windowHours: 24, matrix,
    });
    expect(() => reportToEventBus(() => { throw new Error('bad bus'); }, row, matrix)).not.toThrow();
  });
});

describe('reportToStateMachine', () => {
  it('emits a summary-tagged run.completed event', () => {
    const matrix = buildAttestationMatrix([], { telemetry: 'present', packages: [] });
    const row = buildRunRow({
      startedAt: new Date(), finishedAt: new Date(),
      site: 'caia-mac', telemetry: 'present', windowHours: 24, matrix,
    });
    let captured: ActivationEvent | null = null;
    reportToStateMachine((e) => { captured = e; }, row);
    expect(captured).not.toBeNull();
    expect(captured!.type).toBe('activation-steward.run.completed');
    expect(captured!.payload.note).toContain('green=');
  });
});
