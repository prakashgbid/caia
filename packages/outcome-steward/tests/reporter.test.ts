import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildRunRow } from '../src/attestation.js';
import { buildAttestationMatrix } from '../src/matrix.js';
import {
  reportToEventBus,
  reportToInbox,
  reportToStateMachine,
  summariseGreenAttestations,
} from '../src/reporter.js';
import type { CrossCheckResult, ExpectedSli, OutcomeEvent } from '../src/types.js';

async function mkTmp(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), 'outcome-steward-reporter-'));
}

function sli(overrides: Partial<ExpectedSli> = {}): ExpectedSli {
  return {
    metric: 'pkg:m',
    query: 'q',
    threshold: 1,
    direction: 'gt',
    trendDirection: 'any',
    freshnessHours: 24,
    optional: false,
    ...overrides,
  };
}

function result(overrides: Partial<CrossCheckResult> = {}): CrossCheckResult {
  return {
    packageName: '@caia/x',
    solutionId: 'sol-x',
    sli: sli(),
    latestValue: 5,
    trendSlopePerHour: 0,
    trend: 'flat',
    thresholdSatisfied: true,
    trendSatisfied: true,
    metricPresent: true,
    sampleCount: 3,
    mostRecentAtIso: '2026-05-25T00:00:00.000Z',
    ...overrides,
  };
}

function makeRun(opts: { backend?: 'present' | 'absent' | 'degraded'; results: CrossCheckResult[] }) {
  const m = buildAttestationMatrix(opts.results, { backend: opts.backend ?? 'present' });
  const run = buildRunRow({
    startedAt: new Date('2026-05-25T00:00:00Z'),
    finishedAt: new Date('2026-05-25T00:00:01Z'),
    site: 't',
    backend: opts.backend ?? 'present',
    windowHours: 24,
    matrix: m,
  });
  return { run, matrix: m };
}

describe('reportToInbox', () => {
  let dir: string;
  beforeEach(async () => { dir = await mkTmp(); });
  afterEach(async () => { await fs.rm(dir, { recursive: true, force: true }); });

  it('is a no-op when there are no reds and backend is not degraded', async () => {
    const { run, matrix } = makeRun({ results: [result()] });
    const out = await reportToInbox(path.join(dir, 'INBOX.md'), run, matrix);
    expect(out.appended).toBe(false);
  });

  it('writes a section per red cell', async () => {
    const { run, matrix } = makeRun({
      results: [result({ thresholdSatisfied: false, latestValue: 0 })],
    });
    const p = path.join(dir, 'INBOX.md');
    const out = await reportToInbox(p, run, matrix);
    expect(out.appended).toBe(true);
    expect(out.entriesWritten).toBe(1);
    const text = await fs.readFile(p, 'utf8');
    expect(text).toContain('## OUTCOME-STEWARD FAILURES');
    expect(text).toContain(run.runId);
  });

  it('writes a degraded section when backend is degraded', async () => {
    const { run, matrix } = makeRun({ backend: 'degraded', results: [result()] });
    const p = path.join(dir, 'INBOX.md');
    await reportToInbox(p, run, matrix);
    const text = await fs.readFile(p, 'utf8');
    expect(text).toContain('## OUTCOME-STEWARD DEGRADED');
  });

  it('is idempotent — re-runs with same runId do not append twice', async () => {
    const { run, matrix } = makeRun({
      results: [result({ thresholdSatisfied: false, latestValue: 0 })],
    });
    const p = path.join(dir, 'INBOX.md');
    await reportToInbox(p, run, matrix);
    const before = await fs.readFile(p, 'utf8');
    await reportToInbox(p, run, matrix);
    const after = await fs.readFile(p, 'utf8');
    expect(after).toBe(before);
  });
});

describe('reportToEventBus', () => {
  it('emits run.completed always', () => {
    const events: OutcomeEvent[] = [];
    const { run, matrix } = makeRun({ results: [result()] });
    reportToEventBus((e) => events.push(e), run, matrix);
    expect(events.map((e) => e.type)).toContain('outcome-steward.run.completed');
  });

  it('emits no-metric-store.warning when backend is absent', () => {
    const events: OutcomeEvent[] = [];
    const { run, matrix } = makeRun({ backend: 'absent', results: [result()] });
    reportToEventBus((e) => events.push(e), run, matrix);
    expect(events.map((e) => e.type)).toContain('outcome-steward.no-metric-store.warning');
  });

  it('emits degraded.warning when backend is degraded', () => {
    const events: OutcomeEvent[] = [];
    const { run, matrix } = makeRun({ backend: 'degraded', results: [result()] });
    reportToEventBus((e) => events.push(e), run, matrix);
    expect(events.map((e) => e.type)).toContain('outcome-steward.degraded.warning');
  });

  it('emits attestation.green per green cell', () => {
    const events: OutcomeEvent[] = [];
    const { run, matrix } = makeRun({ results: [result()] });
    const out = reportToEventBus((e) => events.push(e), run, matrix);
    const greens = out.events.filter((e) => e.type === 'outcome-steward.attestation.green');
    expect(greens).toHaveLength(1);
  });

  it('emits attestation.red AND cold-metric per missing-metric red', () => {
    const events: OutcomeEvent[] = [];
    const { run, matrix } = makeRun({
      results: [result({ metricPresent: false, latestValue: null, thresholdSatisfied: false })],
    });
    reportToEventBus((e) => events.push(e), run, matrix);
    const types = events.map((e) => e.type);
    expect(types).toContain('outcome-steward.attestation.red');
    expect(types).toContain('outcome-steward.cold-metric.detected');
  });

  it('emits trend-violation when threshold ok but trend wrong', () => {
    const events: OutcomeEvent[] = [];
    const { run, matrix } = makeRun({
      results: [
        result({
          sli: sli({ trendDirection: 'up' }),
          trend: 'down',
          trendSatisfied: false,
        }),
      ],
    });
    reportToEventBus((e) => events.push(e), run, matrix);
    const types = events.map((e) => e.type);
    expect(types).toContain('outcome-steward.trend-violation.detected');
  });

  it('does NOT throw if emit() throws — keeps run loop alive', () => {
    const { run, matrix } = makeRun({ results: [result()] });
    expect(() => reportToEventBus(() => { throw new Error('bus down'); }, run, matrix)).not.toThrow();
  });
});

describe('reportToStateMachine', () => {
  it('emits a run.completed event with the summary in the note', () => {
    const events: OutcomeEvent[] = [];
    const { run } = makeRun({ results: [result()] });
    reportToStateMachine((e) => events.push(e), run);
    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('outcome-steward.run.completed');
    expect(events[0]!.payload.note).toContain('green=');
  });
});

describe('summariseGreenAttestations', () => {
  it('groups by solutionId', () => {
    const out = summariseGreenAttestations([
      {
        attestationId: 'a', runId: 'r', packageName: 'p', solutionId: 's1', sliMetric: 'm',
        value: 1, threshold: 0, direction: 'gt', windowHours: 24, observedAt: '', site: 't',
      },
      {
        attestationId: 'b', runId: 'r', packageName: 'p', solutionId: 's1', sliMetric: 'm2',
        value: 1, threshold: 0, direction: 'gt', windowHours: 24, observedAt: '', site: 't',
      },
      {
        attestationId: 'c', runId: 'r', packageName: 'p', solutionId: 's2', sliMetric: 'm',
        value: 1, threshold: 0, direction: 'gt', windowHours: 24, observedAt: '', site: 't',
      },
    ]);
    expect(out).toBe('s1=2, s2=1');
  });

  it('returns a helpful string on empty input', () => {
    expect(summariseGreenAttestations([])).toBe('no green attestations');
  });
});
