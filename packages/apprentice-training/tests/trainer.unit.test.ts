/**
 * Trainer orchestration unit tests with a mocked subprocess. The fake
 * subprocess "produces" the canonical mlx-lm output files inside the
 * adapter directory, allowing us to exercise the full happy path
 * without touching real MLX.
 */

import { describe, it, expect } from 'vitest';
import { ApprenticeTrainer } from '../src/trainer.js';
import {
  createInMemoryFs,
  createFakeSubprocess,
  fixtureSample,
  fixtureManifest
} from './helpers/fakes.js';
import { REQUIRED_MLX_FLAGS } from '../src/preflight.js';
import {
  AdapterNotProducedError,
  MlxLoraSubprocessError,
  TrainingError
} from '../src/types.js';
import * as path from 'node:path';

const SUCCESS_HELP_TAIL = REQUIRED_MLX_FLAGS.join('\n');

function buildHappyPath(opts: { sampleCount?: number; holdout?: string[] } = {}) {
  const sampleCount = opts.sampleCount ?? 12;
  const samples = Array.from({ length: sampleCount }, (_, i) =>
    fixtureSample(`s-${String(i).padStart(3, '0')}`)
  );
  const manifestObj = fixtureManifest({
    outputDir: '/corpus/2026-05-06',
    totalSamples: sampleCount,
    ...(opts.holdout ? { holdout: opts.holdout } : {})
  });

  const fs = createInMemoryFs({
    '/corpus/2026-05-06/manifest.json': JSON.stringify(manifestObj),
    '/corpus/2026-05-06/samples.jsonl': samples.map(s => JSON.stringify(s)).join('\n')
  });
  fs.mkdir('/work');
  fs.mkdir('/adapters');

  const sub = createFakeSubprocess(fs, callArgs => {
    if (callArgs.args.includes('--help')) {
      return { exitCode: 0, logTail: SUCCESS_HELP_TAIL };
    }
    // Real "training" call — produce the canonical artifacts.
    const adapterIdx = callArgs.args.indexOf('--adapter-path');
    const adapterPath = callArgs.args[adapterIdx + 1]!;
    return {
      exitCode: 0,
      elapsedMs: 5_000,
      produces: (fakeFs) => {
        fakeFs.mkdir(adapterPath);
        fakeFs.writeFile(`${adapterPath}/adapters.safetensors`, 'binary-stub-data-not-empty');
        fakeFs.writeFile(
          `${adapterPath}/adapter_config.json`,
          JSON.stringify({ num_layers: 16, rank: 8 })
        );
      }
    };
  });

  return { samples, fs, sub, manifestObj };
}

describe('ApprenticeTrainer — happy path', () => {
  it('runs the full pipeline + produces canonical adapter files', async () => {
    const { fs, sub } = buildHappyPath();
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 2, numLayers: 2 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub,
      clock: () => new Date('2026-05-06T12:00:00Z')
    });

    const result = await trainer.train({ skipMlxLmCheck: true });

    expect(result.adapterPath).toMatch(/2026-05-06-qwen2.5-coder-7b-rank8-iters2/);
    expect(fs.exists(result.adapterFile)).toBe(true);
    expect(fs.exists(result.adapterConfigFile)).toBe(true);
    expect(fs.exists(result.trainingMetadataPath)).toBe(true);
    expect(fs.exists(result.modelfilePath)).toBe(true);

    const md = JSON.parse(fs.readFile(result.trainingMetadataPath));
    expect(md.version).toBe(1);
    expect(md.corpusTotals.samplesUsed).toBeGreaterThan(0);
    expect(md.subprocess.exitCode).toBe(0);

    // Subprocess was invoked exactly once (no --help check, since we skipped).
    expect(sub.invocations.length).toBe(1);
    const callArgs = sub.invocations[0]!;
    expect(callArgs.args).toContain('--train');
    expect(callArgs.args).toContain('--num-layers');
    expect(callArgs.args).toContain('2'); // numLayers
    expect(callArgs.args).toContain('--mask-prompt');
    expect(callArgs.args).toContain('--grad-checkpoint');

    // ANTHROPIC_API_KEY MUST be cleared from subprocess env (defence-in-depth
    // against `feedback_no_api_key_billing.md`).
    expect(callArgs.env.ANTHROPIC_API_KEY).toBeUndefined();
  });

  it('honours manifest.holdout when provided', async () => {
    const holdout = ['s-001', 's-005', 's-007'];
    const { fs, sub } = buildHappyPath({ sampleCount: 30, holdout });
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub,
      clock: () => new Date('2026-05-06T12:00:00Z')
    });

    const result = await trainer.train({ skipMlxLmCheck: true });

    expect(result.metadata.corpusTotals.testCount).toBe(holdout.length);
  });

  it('writes lora.yaml + train/valid/test JSONL in workDir', async () => {
    const { fs, sub } = buildHappyPath();
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub,
      clock: () => new Date('2026-05-06T12:00:00Z')
    });

    await trainer.train({ skipMlxLmCheck: true });

    // Find the work-dir that was created.
    const workSubdirs = fs.readDir('/work');
    expect(workSubdirs.length).toBe(1);
    const workDir = path.join('/work', workSubdirs[0]!);
    expect(fs.exists(`${workDir}/train.jsonl`)).toBe(true);
    expect(fs.exists(`${workDir}/valid.jsonl`)).toBe(true);
    expect(fs.exists(`${workDir}/test.jsonl`)).toBe(true);
    expect(fs.exists(`${workDir}/lora.yaml`)).toBe(true);
    expect(fs.exists(`${workDir}/config-snapshot.json`)).toBe(true);

    const yaml = fs.readFile(`${workDir}/lora.yaml`);
    expect(yaml).toMatch(/rank:/);
    expect(yaml).toMatch(/scale:/);
  });

  it('invokes evalHarness when evalAfterTrain && evalHarness', async () => {
    const { fs, sub } = buildHappyPath();
    let evalCalled = false;
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub,
      clock: () => new Date('2026-05-06T12:00:00Z'),
      evalAfterTrain: true,
      evalHarness: {
        async evaluate(req) {
          evalCalled = true;
          expect(req.adapters.length).toBe(1);
          return {
            adapters: [
              {
                name: req.adapters[0]!.name,
                winRate: 0.62,
                decision: 'promote-canary' as const,
                regressionFlags: []
              }
            ],
            outputDir: '/eval/runs/x'
          };
        }
      }
    });

    const result = await trainer.train({ skipMlxLmCheck: true });
    expect(evalCalled).toBe(true);
    expect(result.evalReport?.decision).toBe('promote-canary');
    expect(result.evalReport?.winRate).toBeCloseTo(0.62);
    // eval-report.json side-car written
    expect(fs.exists(`${result.adapterPath}/eval-report.json`)).toBe(true);
  });

  it('skips evalHarness when evalAfterTrain=false', async () => {
    const { fs, sub } = buildHappyPath();
    let evalCalled = false;
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub,
      clock: () => new Date('2026-05-06T12:00:00Z'),
      evalAfterTrain: false,
      evalHarness: {
        async evaluate() {
          evalCalled = true;
          return { adapters: [], outputDir: '/' };
        }
      }
    });

    const result = await trainer.train({ skipMlxLmCheck: true });
    expect(evalCalled).toBe(false);
    expect(result.evalReport).toBeUndefined();
  });

  it('dry-run writes metadata + Modelfile but does NOT spawn subprocess', async () => {
    const { fs, sub } = buildHappyPath();
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub,
      clock: () => new Date('2026-05-06T12:00:00Z')
    });

    const result = await trainer.train({ skipMlxLmCheck: true, dryRun: true });
    expect(sub.invocations.length).toBe(0);
    expect(fs.exists(result.trainingMetadataPath)).toBe(true);
    expect(fs.exists(result.modelfilePath)).toBe(true);
  });
});

describe('ApprenticeTrainer — error paths', () => {
  it('throws ConfigValidationError on illegal split fractions', () => {
    expect(
      () =>
        new ApprenticeTrainer({
          trainSplitFraction: 0.5,
          validSplitFraction: 0.5,
          testSplitFraction: 0.5
        })
    ).toThrow(TrainingError);
  });

  it('throws MlxLoraSubprocessError when subprocess exits non-zero', async () => {
    const { fs } = buildHappyPath();
    const sub = createFakeSubprocess(fs, callArgs => {
      if (callArgs.args.includes('--help')) {
        return { exitCode: 0, logTail: SUCCESS_HELP_TAIL };
      }
      return { exitCode: 1, logTail: 'mlx_lm: OOM\nout of memory' };
    });
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub
    });
    await expect(trainer.train({ skipMlxLmCheck: true })).rejects.toThrow(MlxLoraSubprocessError);
  });

  it('throws AdapterNotProducedError when subprocess exits 0 but no adapter file', async () => {
    const { fs } = buildHappyPath();
    const sub = createFakeSubprocess(fs, callArgs => {
      if (callArgs.args.includes('--help')) {
        return { exitCode: 0, logTail: SUCCESS_HELP_TAIL };
      }
      // Exit 0 but DON'T produce any adapter files.
      return { exitCode: 0, logTail: 'training done' };
    });
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub
    });
    await expect(trainer.train({ skipMlxLmCheck: true })).rejects.toThrow(AdapterNotProducedError);
  });

  it('throws when subprocess times out', async () => {
    const { fs } = buildHappyPath();
    const sub = createFakeSubprocess(fs, callArgs => {
      if (callArgs.args.includes('--help')) {
        return { exitCode: 0, logTail: SUCCESS_HELP_TAIL };
      }
      return { exitCode: 137, signal: 'SIGKILL', timedOut: true, logTail: 'killed' };
    });
    const trainer = new ApprenticeTrainer({
      corpusManifestPath: '/corpus/2026-05-06/manifest.json',
      outputAdapterRoot: '/adapters',
      workDirRoot: '/work',
      loraConfig: { iters: 1, numLayers: 1 },
      minSamplesToTrain: 3,
      fs,
      subprocessRunner: sub
    });
    await expect(trainer.train({ skipMlxLmCheck: true })).rejects.toThrow(/timed out/);
  });
});
