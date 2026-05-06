/**
 * Configuration resolver — fills CAIA defaults for any omitted field.
 * See DESIGN.md §16 for the canonical default table.
 */

import * as os from 'node:os';
import * as path from 'node:path';
import { defaultFsAccess } from './fs-access.js';
import { defaultSubprocessRunner } from './subprocess-runner.js';
import type {
  ApprenticeTrainingConfig,
  LoraConfig,
  ResolvedTrainingConfig
} from './types.js';

/**
 * 16 GB Mac M1 Pro-tuned defaults. These are conservative starting points;
 * Phase 4's retrainer cron will hyperparameter-sweep over a grid once the
 * eval harness can compare adapter variants.
 */
export const DEFAULT_LORA_CONFIG: LoraConfig = Object.freeze({
  numLayers: 16,
  rank: 8,
  alpha: 16,
  dropout: 0.0,
  learningRate: 1e-5,
  iters: 500,
  batchSize: 1,
  maxSeqLength: 2048,
  gradAccumulationSteps: 4,
  gradCheckpoint: true,
  maskPrompt: true,
  saveEvery: 100,
  stepsPerEval: 50,
  valBatches: 8,
  seed: 42
});

const DEFAULT_BASE_MODEL = 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit';
const DEFAULT_BASE_OLLAMA_TAG = 'qwen2.5-coder:7b';

/**
 * Expand a leading `~` to the user's home directory. Idempotent on
 * absolute paths.
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/')) {
    return path.join(os.homedir(), p.slice(2));
  }
  if (p === '~') {
    return os.homedir();
  }
  return p;
}

/**
 * Resolve a config-with-defaults into the trainer's internal shape.
 * - Every field is set (no `undefined`).
 * - LoRA fields fall back to DEFAULT_LORA_CONFIG one-by-one (deep merge).
 * - Paths are home-expanded.
 * - Env vars override built-in CAIA defaults but NOT explicit user values.
 */
export function resolveConfig(input: ApprenticeTrainingConfig = {}): ResolvedTrainingConfig {
  const env = process.env;

  const corpusManifestPath = expandHome(
    input.corpusManifestPath
      ?? env.APPRENTICE_CORPUS_MANIFEST
      ?? path.join(
        env.APPRENTICE_CORPUS_ROOT ?? expandHome('~/Documents/projects/apprentice/corpora'),
        'latest',
        'manifest.json'
      )
  );

  const outputAdapterRoot = expandHome(
    input.outputAdapterRoot
      ?? env.APPRENTICE_ADAPTER_ROOT
      ?? '~/Documents/projects/apprentice/adapters'
  );

  const workDirRoot = expandHome(
    input.workDirRoot
      ?? env.APPRENTICE_WORK_ROOT
      ?? '~/Documents/projects/apprentice/work'
  );

  const baseModel = input.baseModel ?? env.APPRENTICE_BASE_MODEL ?? DEFAULT_BASE_MODEL;
  const baseModelOllamaTag =
    input.baseModelOllamaTag ?? env.APPRENTICE_BASE_OLLAMA_TAG ?? DEFAULT_BASE_OLLAMA_TAG;

  const pythonBinaryPath = input.pythonBinaryPath ?? env.PYTHON_BINARY ?? 'python3';
  const mlxLmModule = input.mlxLmModule ?? 'mlx_lm.lora';

  const loraConfig: LoraConfig = {
    ...DEFAULT_LORA_CONFIG,
    ...(input.loraConfig ?? {})
  };

  const resolved: ResolvedTrainingConfig = {
    corpusManifestPath,
    outputAdapterRoot,
    workDirRoot,
    baseModel,
    baseModelOllamaTag,
    pythonBinaryPath,
    mlxLmModule,
    loraConfig,
    trainSplitFraction: input.trainSplitFraction ?? 0.85,
    validSplitFraction: input.validSplitFraction ?? 0.1,
    testSplitFraction: input.testSplitFraction ?? 0.05,
    splitSeed: input.splitSeed ?? 42,
    minSamplesToTrain: input.minSamplesToTrain ?? 5,
    trainingTimeoutMs: input.trainingTimeoutMs ?? 14_400_000,
    cloudGpuEnabled: input.cloudGpuEnabled ?? false,
    evalAfterTrain: input.evalAfterTrain ?? true,
    subprocessRunner: input.subprocessRunner ?? defaultSubprocessRunner,
    fs: input.fs ?? defaultFsAccess,
    clock: input.clock ?? (() => new Date())
  };

  // exactOptionalPropertyTypes — only attach evalHarness when the caller provided one.
  if (input.evalHarness !== undefined) {
    resolved.evalHarness = input.evalHarness;
  }

  return resolved;
}

/**
 * Validate a resolved config — throws on any obvious-misconfiguration
 * before we even reach preflight. Catches operator typos at the CLI seam.
 */
export function validateResolvedConfig(cfg: ResolvedTrainingConfig): string[] {
  const errs: string[] = [];

  if (cfg.loraConfig.numLayers < 1) errs.push('loraConfig.numLayers must be ≥ 1');
  if (cfg.loraConfig.rank < 1) errs.push('loraConfig.rank must be ≥ 1');
  if (cfg.loraConfig.iters < 1) errs.push('loraConfig.iters must be ≥ 1');
  if (cfg.loraConfig.batchSize < 1) errs.push('loraConfig.batchSize must be ≥ 1');
  if (cfg.loraConfig.maxSeqLength < 64) errs.push('loraConfig.maxSeqLength must be ≥ 64');
  if (cfg.loraConfig.learningRate <= 0) errs.push('loraConfig.learningRate must be > 0');

  const sum = cfg.trainSplitFraction + cfg.validSplitFraction + cfg.testSplitFraction;
  if (Math.abs(sum - 1) > 0.001) {
    errs.push(`split fractions must sum to 1.0; got ${sum}`);
  }

  if (cfg.minSamplesToTrain < 1) errs.push('minSamplesToTrain must be ≥ 1');
  if (cfg.trainingTimeoutMs < 1_000) errs.push('trainingTimeoutMs must be ≥ 1000');

  return errs;
}
