import { describe, it, expect } from 'vitest';
import {
  resolveConfig,
  validateResolvedConfig,
  DEFAULT_LORA_CONFIG,
  expandHome
} from '../src/config.js';

describe('expandHome', () => {
  it('expands ~/ to the home directory', () => {
    expect(expandHome('~/foo')).toMatch(/^\/.+\/foo$/);
  });
  it('leaves absolute paths alone', () => {
    expect(expandHome('/tmp/x')).toBe('/tmp/x');
  });
  it('leaves bare ~ as the home dir itself', () => {
    expect(expandHome('~')).toMatch(/^\/.+$/);
    expect(expandHome('~').includes('~')).toBe(false);
  });
});

describe('resolveConfig', () => {
  it('fills CAIA defaults when given empty input', () => {
    const cfg = resolveConfig({});
    expect(cfg.baseModel).toBe('mlx-community/Qwen2.5-Coder-7B-Instruct-4bit');
    expect(cfg.baseModelOllamaTag).toBe('qwen2.5-coder:7b');
    expect(cfg.pythonBinaryPath).toBe('python3');
    expect(cfg.mlxLmModule).toBe('mlx_lm.lora');
    expect(cfg.loraConfig).toEqual(DEFAULT_LORA_CONFIG);
    expect(cfg.trainSplitFraction).toBeCloseTo(0.85);
    expect(cfg.validSplitFraction).toBeCloseTo(0.10);
    expect(cfg.testSplitFraction).toBeCloseTo(0.05);
    expect(cfg.splitSeed).toBe(42);
    expect(cfg.cloudGpuEnabled).toBe(false);
    expect(cfg.evalAfterTrain).toBe(true);
  });

  it('respects explicit overrides', () => {
    const cfg = resolveConfig({
      baseModel: 'mlx-community/Mistral-7B-v0.3-4bit',
      loraConfig: { numLayers: 8, rank: 16 },
      trainSplitFraction: 0.8,
      validSplitFraction: 0.15,
      testSplitFraction: 0.05
    });
    expect(cfg.baseModel).toBe('mlx-community/Mistral-7B-v0.3-4bit');
    expect(cfg.loraConfig.numLayers).toBe(8);
    expect(cfg.loraConfig.rank).toBe(16);
    // Other LoRA fields keep defaults.
    expect(cfg.loraConfig.iters).toBe(DEFAULT_LORA_CONFIG.iters);
    expect(cfg.trainSplitFraction).toBeCloseTo(0.8);
  });

  it('omits evalHarness key entirely when not provided (exactOptionalPropertyTypes)', () => {
    const cfg = resolveConfig({});
    expect('evalHarness' in cfg).toBe(false);
  });

  it('includes evalHarness when provided', () => {
    const harness = { evaluate: async () => ({ adapters: [], outputDir: '' }) };
    const cfg = resolveConfig({ evalHarness: harness });
    expect(cfg.evalHarness).toBe(harness);
  });
});

describe('validateResolvedConfig', () => {
  it('returns no errors for the default config', () => {
    expect(validateResolvedConfig(resolveConfig({}))).toEqual([]);
  });

  it('flags split fractions that do not sum to 1', () => {
    const cfg = resolveConfig({ trainSplitFraction: 0.5, validSplitFraction: 0.1, testSplitFraction: 0.1 });
    const errs = validateResolvedConfig(cfg);
    expect(errs.length).toBeGreaterThan(0);
    expect(errs.join('\n')).toMatch(/sum to 1/);
  });

  it('flags illegal LoRA hyperparameters', () => {
    const cfg = resolveConfig({ loraConfig: { numLayers: 0, rank: -1, iters: 0, batchSize: 0, learningRate: 0, maxSeqLength: 32 } });
    const errs = validateResolvedConfig(cfg);
    expect(errs.length).toBeGreaterThanOrEqual(5);
  });

  it('flags too-low minSamplesToTrain or trainingTimeoutMs', () => {
    const cfg = resolveConfig({ minSamplesToTrain: 0, trainingTimeoutMs: 100 });
    const errs = validateResolvedConfig(cfg);
    expect(errs.find(e => e.includes('minSamplesToTrain'))).toBeDefined();
    expect(errs.find(e => e.includes('trainingTimeoutMs'))).toBeDefined();
  });
});
