import { describe, expect, it } from 'vitest';
import { ApprenticeRetrainer } from '../src/retrainer.js';
import {
  createFakeClock,
  createFakeCorpusAggregator,
  createFakeEvalHarness,
  createFakeServing,
  createFakeTrainer,
  createInMemoryFs,
  passingManifest
} from './helpers/fakes.js';

describe('ApprenticeRetrainer.run() — orchestration', () => {
  it('skips when last train is recent and no canary', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fc.setNow('2026-05-09T02:00:00.000Z');
    // Pre-seed a recent training in state.
    fs.put(
      '/data/state.json',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-08T00:00:00.000Z',
          lastSuccessfulTrain: {
            at: '2026-05-08T00:00:00.000Z',
            adapterPath: '/a/x',
            adapterName: 'x',
            corpusManifestSha256: 'sha',
            outcome: 'trained-and-canary-promoted'
          },
          lastCanaryPromotedAt: '2026-05-08T00:00:00.000Z',
          lastProductionPromotedAt: null,
          lastError: null,
          history: []
        },
        null,
        2
      )
    );
    // currentCanary is undefined because we don't pre-populate fakeServing.
    // But state shows a recent train + canary promotion timestamp; preTrain
    // decision will short-circuit on age check. To exercise skip-no-delta,
    // we need NO active canary in serving — which the empty fake provides.
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      corpusAggregator: createFakeCorpusAggregator([]),
      trainer: createFakeTrainer([]),
      serving: createFakeServing()
    });
    const result = await r.run();
    expect(result.kind).toBe('skipped-no-delta');
  });

  it('runs full train cycle and promotes-to-canary on good eval', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fc.setNow('2026-05-06T02:00:00.000Z');
    fs.put('/corpus/2026-05-06/manifest.json', passingManifest());
    const aggregator = createFakeCorpusAggregator([
      {
        manifestPath: '/corpus/2026-05-06/manifest.json',
        corpusManifestSha256: 'sha-2026-05-06',
        totalSamples: 600,
        newSamplesSinceLastRun: 600
      }
    ]);
    const trainer = createFakeTrainer([
      {
        adapterPath: '/adapters/2026-05-06-qwen',
        configSha256: 'cfg-2026-05-06',
        baseModelOllamaTag: 'qwen2.5-coder:7b'
      }
    ]);
    const evalH = createFakeEvalHarness([
      { name: '2026-05-06-qwen', winRate: 0.72, decision: 'promote-canary', regressionFlags: [] }
    ]);
    const serving = createFakeServing();
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      corpusAggregator: aggregator,
      trainer,
      evalHarness: evalH,
      serving
    });
    const result = await r.run();
    expect(result.kind).toBe('trained-and-canary-promoted');
    if (result.kind === 'trained-and-canary-promoted') {
      expect(result.canaryPercent).toBe(10);
    }
    // Serving received the calls in order: register, then promoteToCanary.
    const ops = serving.fakeState.calls.map((c) => c.op);
    expect(ops).toEqual(['register', 'promoteToCanary']);
    expect(trainer.invocations).toHaveLength(1);
    expect(evalH.invocations).toHaveLength(1);
  });

  it('rejects when eval winRate below gate', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fs.put('/m', passingManifest());
    const aggregator = createFakeCorpusAggregator([
      {
        manifestPath: '/m',
        corpusManifestSha256: 'sha',
        totalSamples: 600,
        newSamplesSinceLastRun: 600
      }
    ]);
    const trainer = createFakeTrainer([
      { adapterPath: '/a/x', configSha256: 'cfg', baseModelOllamaTag: 'qwen2.5-coder:7b' }
    ]);
    const evalH = createFakeEvalHarness([
      { name: 'x', winRate: 0.45, decision: 'reject', regressionFlags: [] }
    ]);
    const serving = createFakeServing();
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      corpusAggregator: aggregator,
      trainer,
      evalHarness: evalH,
      serving
    });
    const result = await r.run();
    expect(result.kind).toBe('trained-and-rejected');
    expect(serving.fakeState.calls.map((c) => c.op)).toEqual(['register', 'reject']);
  });

  it('rejects-no-eval when evalHarness undefined', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fs.put('/m', passingManifest());
    const aggregator = createFakeCorpusAggregator([
      {
        manifestPath: '/m',
        corpusManifestSha256: 'sha',
        totalSamples: 600,
        newSamplesSinceLastRun: 600
      }
    ]);
    const trainer = createFakeTrainer([
      { adapterPath: '/a/x', configSha256: 'cfg', baseModelOllamaTag: 'qwen2.5-coder:7b' }
    ]);
    const serving = createFakeServing();
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      corpusAggregator: aggregator,
      trainer,
      // evalHarness deliberately omitted
      serving
    });
    const result = await r.run();
    expect(result.kind).toBe('trained-and-rejected');
    if (result.kind === 'trained-and-rejected') {
      expect(result.reason).toContain('eval harness not configured');
    }
  });

  it('records failed outcome on training error', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fs.put('/m', passingManifest());
    const aggregator = createFakeCorpusAggregator([
      {
        manifestPath: '/m',
        corpusManifestSha256: 'sha',
        totalSamples: 600,
        newSamplesSinceLastRun: 600
      }
    ]);
    const trainer = {
      invocations: [],
      scripted: [],
      async train() {
        throw new Error('mlx OOM');
      }
    };
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      corpusAggregator: aggregator,
      trainer,
      serving: createFakeServing()
    });
    const result = await r.run();
    expect(result.kind).toBe('failed');
    if (result.kind === 'failed') {
      expect(result.error.kind).toBe('TrainingFailedError');
    }
    const state = JSON.parse(fs.readFile('/data/state.json'));
    expect(state.lastError?.kind).toBe('TrainingFailedError');
  });

  it('skipped-canary-active when canary < 3 days old', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fc.setNow('2026-05-08T02:00:00.000Z');
    const serving = createFakeServing();
    // Pre-seed a canary registered 1 day ago.
    serving.fakeState.registered.set('q', {
      adapterName: 'q',
      adapterPath: '/a/q',
      metadataSha256: 'a'.repeat(64),
      configSha256: 'cfg',
      baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
      baseModelOllamaTag: 'qwen2.5-coder:7b',
      status: 'canary',
      history: [],
      canaryPercent: 10,
      ollamaModelName: 'q-canary-abc',
      registeredAt: '2026-05-07T02:00:00.000Z',
      promotedAt: '2026-05-07T02:00:00.000Z'
    });
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      serving
    });
    const result = await r.run();
    expect(result.kind).toBe('skipped-canary-active');
  });

  it('canary-held-prompting-operator when canary >= 3 days old', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    fc.setNow('2026-05-13T02:00:00.000Z'); // 6 days after promotion
    const serving = createFakeServing();
    serving.fakeState.registered.set('q', {
      adapterName: 'q',
      adapterPath: '/a/q',
      metadataSha256: 'a'.repeat(64),
      configSha256: 'cfg',
      baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
      baseModelOllamaTag: 'qwen2.5-coder:7b',
      status: 'canary',
      history: [],
      canaryPercent: 10,
      ollamaModelName: 'q-canary-abc',
      registeredAt: '2026-05-07T02:00:00.000Z',
      promotedAt: '2026-05-07T02:00:00.000Z'
    });
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      serving
    });
    const result = await r.run();
    expect(result.kind).toBe('canary-held-prompting-operator');
    const digest = fs.readFile('/reports/d.md');
    expect(digest).toContain('Operator action required');
  });
});

describe('ApprenticeRetrainer — operator-driven actions', () => {
  it('promoteCanaryToProduction calls serving.promoteToProduction', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    const serving = createFakeServing();
    serving.fakeState.registered.set('q', {
      adapterName: 'q',
      adapterPath: '/a/q',
      metadataSha256: 'a'.repeat(64),
      configSha256: 'cfg',
      baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
      baseModelOllamaTag: 'qwen2.5-coder:7b',
      status: 'canary',
      history: [],
      canaryPercent: 10,
      ollamaModelName: 'q-canary',
      registeredAt: '2026-05-06T00:00:00.000Z',
      promotedAt: '2026-05-06T00:00:00.000Z'
    });
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      serving
    });
    const promoted = await r.promoteCanaryToProduction();
    expect(promoted.status).toBe('production');
    expect(serving.fakeState.calls.some((c) => c.op === 'promoteToProduction')).toBe(true);
  });

  it('rejectCanary calls serving.reject', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();
    const serving = createFakeServing();
    serving.fakeState.registered.set('q', {
      adapterName: 'q',
      adapterPath: '/a/q',
      metadataSha256: 'a'.repeat(64),
      configSha256: 'cfg',
      baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
      baseModelOllamaTag: 'qwen2.5-coder:7b',
      status: 'canary',
      history: [],
      canaryPercent: 10,
      ollamaModelName: 'q-canary',
      registeredAt: '2026-05-06T00:00:00.000Z',
      promotedAt: '2026-05-06T00:00:00.000Z'
    });
    const r = new ApprenticeRetrainer({
      runStatePath: '/data/state.json',
      digestPath: '/reports/d.md',
      lockfilePath: '/data/lock',
      fs,
      clock: fc.clock,
      serving
    });
    const rej = await r.rejectCanary('regression on prompt-12');
    expect(rej.status).toBe('rejected');
    expect(rej.rejectionReason).toBe('regression on prompt-12');
  });
});
