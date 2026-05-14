/**
 * APP.2 quality-gate — unit tests.
 *
 * Two layers:
 *   - Pure: `averageQualityFromHistogram` and `decideQualityGate` cover both
 *     gate branches without any retrainer wiring.
 *   - Wired: `ApprenticeRetrainer.run()` end-to-end covers
 *       below-floor → `gated-pending-quality` (no train, audit row appended)
 *       above-floor → train proceeds through to canary promotion.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApprenticeRetrainer } from '../src/retrainer.js';
import {
  averageQualityFromHistogram,
  decideQualityGate
} from '../src/quality-gate.js';
import {
  createFakeClock,
  createFakeCorpusAggregator,
  createFakeEvalHarness,
  createFakeServing,
  createFakeTrainer,
  createInMemoryFs,
  passingManifest
} from './helpers/fakes.js';

describe('averageQualityFromHistogram', () => {
  it('returns 0 for empty / undefined / all-zero histograms', () => {
    expect(averageQualityFromHistogram(undefined)).toBe(0);
    expect(averageQualityFromHistogram({})).toBe(0);
    expect(
      averageQualityFromHistogram({
        '0.0-0.2': 0,
        '0.2-0.4': 0,
        '0.4-0.6': 0,
        '0.6-0.8': 0,
        '0.8-1.0': 0
      })
    ).toBe(0);
  });

  it('weights bin midpoints by their counts', () => {
    // 100 @ 0.1 + 100 @ 0.9 → mean 0.5
    const avg = averageQualityFromHistogram({
      '0.0-0.2': 100,
      '0.8-1.0': 100
    });
    expect(avg).toBeCloseTo(0.5, 6);
  });

  it('ignores unknown bin keys', () => {
    const avg = averageQualityFromHistogram({
      '0.4-0.6': 100,
      // unexpected bin — must not poison the weighted mean
      'unknown': 9999
    });
    expect(avg).toBeCloseTo(0.5, 6);
  });
});

describe('decideQualityGate', () => {
  const floor = { qualityFloorAvg: 0.55, qualityFloorCount: 300 };

  it('passes when avg + count both clear the floor', () => {
    const d = decideQualityGate({
      manifest: {
        totals: { final: 600 },
        qualityHistogram: { '0.4-0.6': 200, '0.6-0.8': 300, '0.8-1.0': 100 }
      },
      ...floor
    });
    expect(d.pass).toBe(true);
    expect(d.avg).toBeGreaterThanOrEqual(0.55);
    expect(d.count).toBe(600);
  });

  it('fails on low avg even when count is high', () => {
    const d = decideQualityGate({
      manifest: {
        totals: { final: 1000 },
        // mass piled in 0.2-0.4 → avg ≈ 0.3
        qualityHistogram: { '0.0-0.2': 200, '0.2-0.4': 800 }
      },
      ...floor
    });
    expect(d.pass).toBe(false);
    expect(d.reason).toContain('avg=');
  });

  it('fails on low count even when avg is high', () => {
    const d = decideQualityGate({
      manifest: {
        totals: { final: 100 },
        qualityHistogram: { '0.8-1.0': 100 }
      },
      ...floor
    });
    expect(d.pass).toBe(false);
    expect(d.count).toBe(100);
    expect(d.reason).toContain('count=');
  });

  it('reports both reasons when both floors are missed', () => {
    const d = decideQualityGate({
      manifest: { totals: { final: 50 }, qualityHistogram: { '0.0-0.2': 50 } },
      ...floor
    });
    expect(d.pass).toBe(false);
    expect(d.reason).toContain('avg=');
    expect(d.reason).toContain('count=');
  });

  it('treats missing totals.final as 0', () => {
    const d = decideQualityGate({
      manifest: { qualityHistogram: { '0.8-1.0': 1000 } },
      ...floor
    });
    expect(d.pass).toBe(false);
    expect(d.count).toBe(0);
  });
});

describe('ApprenticeRetrainer.run() — APP.2 wired', () => {
  let stdoutSpy: ReturnType<typeof vi.spyOn>;
  let stdoutChunks: string[] = [];

  beforeEach(() => {
    stdoutChunks = [];
    stdoutSpy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk: unknown) => {
      stdoutChunks.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
  });
  afterEach(() => {
    stdoutSpy.mockRestore();
  });

  it('below floor → gated-pending-quality (no train, audit row, exit-clean)', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fc.setNow('2026-05-16T02:00:00.000Z');
    // Manifest: 221 final samples, mostly in the 0.2-0.4 band → avg ≈ 0.3, count 221.
    fs.put(
      '/corpus/2026-05-16/manifest.json',
      passingManifest({
        totals: { final: 221 },
        qualityHistogram: {
          '0.0-0.2': 40,
          '0.2-0.4': 150,
          '0.4-0.6': 30,
          '0.6-0.8': 1,
          '0.8-1.0': 0
        }
      })
    );
    const aggregator = createFakeCorpusAggregator([
      {
        manifestPath: '/corpus/2026-05-16/manifest.json',
        corpusManifestSha256: 'sha-low',
        totalSamples: 221,
        newSamplesSinceLastRun: 221
      }
    ]);
    const trainer = createFakeTrainer([]);
    const evalH = createFakeEvalHarness([]);
    const serving = createFakeServing();

    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      auditPath: '/var/audit/audit.jsonl',
      fs,
      clock: fc.clock,
      corpusAggregator: aggregator,
      trainer,
      evalHarness: evalH,
      serving
    });
    const result = await r.run();

    expect(result.kind).toBe('gated-pending-quality');
    if (result.kind === 'gated-pending-quality') {
      expect(result.count).toBe(221);
      expect(result.avg).toBeLessThan(0.55);
    }

    // Training must NOT have been invoked — quality gate fires before train.
    expect(trainer.invocations).toHaveLength(0);
    expect(evalH.invocations).toHaveLength(0);

    // Structured event on stdout.
    const stdout = stdoutChunks.join('');
    expect(stdout).toContain('"event":"gated-pending-quality"');
    expect(stdout).toContain('"count":221');

    // Audit row appended.
    expect(fs.has('/var/audit/audit.jsonl')).toBe(true);
    const audit = fs.readFile('/var/audit/audit.jsonl');
    expect(audit.trim().split('\n')).toHaveLength(1);
    const row = JSON.parse(audit.trim());
    expect(row.event).toBe('gated-pending-quality');
    expect(row.count).toBe(221);
    expect(row.at).toBe('2026-05-16T02:00:00.000Z');

    // State + digest reflect the skip.
    const state = JSON.parse(fs.readFile('/data/state.json'));
    expect(state.history.at(-1).outcome).toBe('gated-pending-quality');
    expect(fs.readFile('/reports/d.md')).toContain('gated (corpus below quality floor)');
  });

  it('above floor → proceeds through full train + canary promotion', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fc.setNow('2026-06-06T02:00:00.000Z');
    fs.put('/corpus/2026-06-06/manifest.json', passingManifest()); // default 600 / avg ~0.65
    const aggregator = createFakeCorpusAggregator([
      {
        manifestPath: '/corpus/2026-06-06/manifest.json',
        corpusManifestSha256: 'sha-good',
        totalSamples: 600,
        newSamplesSinceLastRun: 600
      }
    ]);
    const trainer = createFakeTrainer([
      {
        adapterPath: '/adapters/2026-06-06-qwen',
        configSha256: 'cfg',
        baseModelOllamaTag: 'qwen2.5-coder:7b'
      }
    ]);
    const evalH = createFakeEvalHarness([
      { name: '2026-06-06-qwen', winRate: 0.72, decision: 'promote-canary', regressionFlags: [] }
    ]);
    const serving = createFakeServing();
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      auditPath: '/var/audit/audit.jsonl',
      fs,
      clock: fc.clock,
      corpusAggregator: aggregator,
      trainer,
      evalHarness: evalH,
      serving
    });
    const result = await r.run();

    expect(result.kind).toBe('trained-and-canary-promoted');
    expect(trainer.invocations).toHaveLength(1);
    expect(evalH.invocations).toHaveLength(1);

    // Gate did NOT fire — no audit row, no gated-pending-quality stdout.
    expect(fs.has('/var/audit/audit.jsonl')).toBe(false);
    const stdout = stdoutChunks.join('');
    expect(stdout).not.toContain('gated-pending-quality');
  });

  it('configurable floor — operator can raise the bar', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fs.put('/m', passingManifest()); // default avg ~0.65, count 600
    const aggregator = createFakeCorpusAggregator([
      {
        manifestPath: '/m',
        corpusManifestSha256: 'sha',
        totalSamples: 600,
        newSamplesSinceLastRun: 600
      }
    ]);
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      auditPath: '/var/audit/audit.jsonl',
      // Raise floors above what the default passingManifest provides.
      qualityFloorAvg: 0.85,
      qualityFloorCount: 5000,
      fs,
      clock: fc.clock,
      corpusAggregator: aggregator,
      trainer: createFakeTrainer([]),
      serving: createFakeServing()
    });
    const result = await r.run();
    expect(result.kind).toBe('gated-pending-quality');
  });
});
