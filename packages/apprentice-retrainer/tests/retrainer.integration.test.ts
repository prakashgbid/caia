/**
 * 3-cycle weekly cadence integration test:
 *   Cycle 1: corpus delta < threshold → skipped-no-delta
 *   Cycle 2: corpus delta ≥ threshold + good eval → trained-and-canary-promoted
 *   Cycle 3: canary still active < 3 days → skipped-canary-active
 *   Cycle 4: canary > 3 days → canary-held-prompting-operator
 *   Cycle 5: operator promotes canary; another retrain runs end-to-end
 */

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

describe('ApprenticeRetrainer integration — 5-cycle weekly cadence', () => {
  it('walks the full lifecycle through 5 cron ticks', async () => {
    const fs = createInMemoryFs();
    const fc = createFakeClock();

    // Pre-seed state with a recent successful train so cycle 1 takes the
    // skip-no-delta short-circuit (last train is < retrainMaxAge, no canary).
    fs.put(
      '/data/state.json',
      JSON.stringify(
        {
          version: 1,
          generatedAt: '2026-05-01T00:00:00.000Z',
          lastSuccessfulTrain: {
            at: '2026-05-01T00:00:00.000Z',
            adapterPath: '/adapters/2026-04-25-qwen',
            adapterName: '2026-04-25-qwen',
            corpusManifestSha256: 'sha-prev',
            outcome: 'trained-and-canary-promoted'
          },
          lastCanaryPromotedAt: null,
          lastProductionPromotedAt: '2026-05-01T00:00:00.000Z',
          lastError: null,
          history: []
        },
        null,
        2
      )
    );

    // Manifests with passing quality so cycles 2 + 5 clear the APP.2 gate.
    fs.put('/c/2026-05-13/manifest.json', passingManifest({ totals: { final: 700 } }));
    fs.put('/c/2026-05-20/manifest.json', passingManifest({ totals: { final: 1500 } }));

    // Scripts: cycle 2 (aged → good train), cycle 5 (aged → good train).
    const aggregator = createFakeCorpusAggregator([
      // cycle 2 — small delta but aged → train anyway
      // cycle 5 — large delta after operator promotes canary
      {
        manifestPath: '/c/2026-05-13/manifest.json',
        corpusManifestSha256: 'sha-2',
        totalSamples: 700,
        newSamplesSinceLastRun: 700
      },
      {
        manifestPath: '/c/2026-05-20/manifest.json',
        corpusManifestSha256: 'sha-3',
        totalSamples: 1500,
        newSamplesSinceLastRun: 1500
      }
    ]);

    const trainer = createFakeTrainer([
      // cycle 2 trains on sha-2
      {
        adapterPath: '/adapters/2026-05-13-qwen',
        configSha256: 'cfg-2',
        baseModelOllamaTag: 'qwen2.5-coder:7b'
      },
      // cycle 5 trains on sha-3
      {
        adapterPath: '/adapters/2026-05-20-qwen',
        configSha256: 'cfg-3',
        baseModelOllamaTag: 'qwen2.5-coder:7b'
      }
    ]);

    const evalH = createFakeEvalHarness([
      // cycle 2 — good
      { name: '2026-05-13-qwen', winRate: 0.72, decision: 'promote-canary', regressionFlags: [] },
      // cycle 5 — good
      { name: '2026-05-20-qwen', winRate: 0.75, decision: 'promote-canary', regressionFlags: [] }
    ]);

    const serving = createFakeServing({ registered: new Map(), calls: [] }, fc.clock);

    function makeRetrainer() {
      return new ApprenticeRetrainer({
        runStatePath: '/data/state.json',
        digestPath: '/reports/digest.md',
        lockfilePath: '/data/lock',
        fs,
        clock: fc.clock,
        corpusAggregator: aggregator,
        trainer,
        evalHarness: evalH,
        serving
      });
    }

    // === Cycle 1 — Saturday May 2: last successful train is recent (May 1),
    // no canary, no force → preTrainDecision short-circuits at skip-no-delta.
    fc.setNow('2026-05-02T02:00:00.000Z');
    {
      const r = makeRetrainer();
      const result = await r.run();
      expect(result.kind).toBe('skipped-no-delta');
    }

    // === Cycle 2 — Saturday May 13 (>7 days later, force aggregation): good train
    fc.setNow('2026-05-13T02:00:00.000Z');
    {
      const r = makeRetrainer();
      const result = await r.run();
      expect(result.kind).toBe('trained-and-canary-promoted');
      expect(serving.currentCanary()?.adapterName).toBe('2026-05-13-qwen');
    }

    // === Cycle 3 — Saturday May 16 (3 days later — CANARY HELD = exactly 3 days, prompts operator)
    fc.setNow('2026-05-16T02:00:00.000Z');
    {
      const r = makeRetrainer();
      const result = await r.run();
      expect(result.kind).toBe('canary-held-prompting-operator');
    }

    // === Cycle 4 — Saturday May 14 (1 day after canary, soak window, skipped)
    fc.setNow('2026-05-14T02:00:00.000Z');
    {
      const r = makeRetrainer();
      const result = await r.run();
      expect(result.kind).toBe('skipped-canary-active');
    }

    // === Operator promotes canary → production
    fc.setNow('2026-05-17T10:00:00.000Z');
    {
      const r = makeRetrainer();
      const promoted = await r.promoteCanaryToProduction();
      expect(promoted.status).toBe('production');
    }

    // === Cycle 5 — Saturday May 23: production stable; new corpus delta; new train cycle
    fc.setNow('2026-05-23T02:00:00.000Z');
    {
      const r = makeRetrainer();
      const result = await r.run();
      expect(result.kind).toBe('trained-and-canary-promoted');
      // Old production v1 should be archived; new canary v2 should exist.
      const v1 = serving.fakeState.registered.get('2026-05-13-qwen');
      const v2 = serving.fakeState.registered.get('2026-05-20-qwen');
      expect(v1?.status).toBe('production');
      expect(v2?.status).toBe('canary');
    }

    // === Verify digest entries written for every cycle
    const digest = fs.readFile('/reports/digest.md');
    expect(digest).toContain('# Apprentice Retrainer — operator digest');
    expect(digest).toContain('skipped (no corpus delta)');
    expect(digest).toContain('trained + promoted to canary');
    expect(digest).toContain('Operator action required');
    expect(digest).toContain('skipped (canary still active)');
    // Operator promote also appends an entry.
    expect(digest).toContain('Operator-promoted canary to production');
  });
});
