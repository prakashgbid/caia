/**
 * Stage 6 — integration test that runs a real `python -m mlx_lm.lora`
 * subprocess against a tiny fixture corpus.
 *
 * Skipped unless the `APPRENTICE_TRAINING_MLX_INSTALLED=1` env var is set.
 * This is intentional: CI machines (and most developers) won't have
 * mlx-lm pip-installed; running this test is the operator's
 * responsibility on their own Mac M-series.
 *
 * To run:
 *   1. Install mlx-lm: `pip install mlx-lm`
 *   2. Run: `APPRENTICE_TRAINING_MLX_INSTALLED=1 pnpm test -- trainer.integration`
 *
 * Expected wall-clock: ~5-10 minutes on Mac M1 Pro 16GB for the
 * fixture (12 samples, 2 iters, rank 2). Includes one-time HF model
 * download (~5 GB) on first run; subsequent runs hit the cache.
 *
 * Stage 8's full E2E verify uses `--iters 500 --num-layers 16 --rank 8`
 * against the real Phase 0 87-sample corpus and runs overnight.
 */

import { describe, it, expect } from 'vitest';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { ApprenticeTrainer } from '../src/trainer.js';
import { fixtureSample, fixtureManifest } from './helpers/fakes.js';
import { defaultFsAccess } from '../src/fs-access.js';
import { defaultSubprocessRunner } from '../src/subprocess-runner.js';

const MLX_INSTALLED = process.env.APPRENTICE_TRAINING_MLX_INSTALLED === '1';
const conditionalDescribe = MLX_INSTALLED ? describe : describe.skip;

conditionalDescribe('ApprenticeTrainer — integration (real MLX)', () => {
  it('produces an adapter from a tiny fixture corpus', async () => {
    // Materialise a 12-sample corpus on real disk.
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'apprentice-training-int-'));
    const corpusDir = path.join(tmpRoot, 'corpora', '2026-05-06');
    const adapterRoot = path.join(tmpRoot, 'adapters');
    const workRoot = path.join(tmpRoot, 'work');
    fs.mkdirSync(corpusDir, { recursive: true });
    fs.mkdirSync(adapterRoot, { recursive: true });
    fs.mkdirSync(workRoot, { recursive: true });

    const samples = Array.from({ length: 12 }, (_, i) =>
      fixtureSample(
        `int-${String(i).padStart(3, '0')}`,
        `Sample question ${i}: what is the standing rule about subscription-only LLM cost?`,
        `Per feedback_no_api_key_billing.md, the Anthropic per-token API is forbidden. Use the claude binary or local Ollama.`
      )
    );
    const manifest = fixtureManifest({
      outputDir: corpusDir,
      totalSamples: samples.length,
      holdout: ['int-001']
    });
    fs.writeFileSync(path.join(corpusDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(
      path.join(corpusDir, 'samples.jsonl'),
      samples.map(s => JSON.stringify(s)).join('\n') + '\n'
    );

    const trainer = new ApprenticeTrainer({
      corpusManifestPath: path.join(corpusDir, 'manifest.json'),
      outputAdapterRoot: adapterRoot,
      workDirRoot: workRoot,
      // Tiny config — minimum viable training run.
      loraConfig: {
        numLayers: 2,
        rank: 2,
        alpha: 4,
        iters: 2,
        batchSize: 1,
        maxSeqLength: 512,
        gradAccumulationSteps: 1,
        gradCheckpoint: false,
        saveEvery: 2,
        stepsPerEval: 2,
        valBatches: 1
      },
      minSamplesToTrain: 5,
      // Real subprocess + fs.
      fs: defaultFsAccess,
      subprocessRunner: defaultSubprocessRunner,
      // Skip eval (we don't have an Ollama harness wired in tests).
      evalAfterTrain: false,
      // Generous timeout: first run includes ~5 GB model download.
      trainingTimeoutMs: 30 * 60 * 1000
    });

    const result = await trainer.train({});

    expect(fs.existsSync(result.adapterFile)).toBe(true);
    expect(fs.existsSync(result.adapterConfigFile)).toBe(true);
    expect(fs.existsSync(result.trainingMetadataPath)).toBe(true);
    expect(fs.existsSync(result.modelfilePath)).toBe(true);
    expect(fs.statSync(result.adapterFile).size).toBeGreaterThan(0);

    const md = JSON.parse(fs.readFileSync(result.trainingMetadataPath, 'utf-8'));
    expect(md.subprocess.exitCode).toBe(0);
    expect(md.corpusTotals.testCount).toBe(1); // holdout

    // Cleanup the temp tree.
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  }, 35 * 60 * 1000); // 35 min vitest timeout
});
