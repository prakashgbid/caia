import { describe, it, expect } from 'vitest';
import { MetadataWriter, configSha256 } from '../src/metadata-writer.js';
import { resolveConfig } from '../src/config.js';
import { createInMemoryFs } from './helpers/fakes.js';

describe('MetadataWriter.write', () => {
  it('writes training-metadata.json + Modelfile', () => {
    const fs = createInMemoryFs();
    fs.mkdir('/adapters/x');
    const writer = new MetadataWriter(fs, () => new Date('2026-05-06T12:00:00Z'));
    const cfg = resolveConfig({});
    const result = writer.write({
      cfg,
      adapterPath: '/adapters/x',
      corpusManifestPath: '/c/manifest.json',
      corpusManifestSha256: 'a'.repeat(64),
      trainCount: 73,
      validCount: 9,
      testCount: 5,
      argv: ['python3', '-m', 'mlx_lm.lora', '--train'],
      exitCode: 0,
      elapsedMs: 1234,
      timedOut: false,
      host: { model: 'darwin', memBytes: 17_179_869_184, arch: 'arm64' },
      warnings: []
    });

    expect(fs.exists('/adapters/x/training-metadata.json')).toBe(true);
    expect(fs.exists('/adapters/x/Modelfile')).toBe(true);
    expect(result.metadata.version).toBe(1);
    expect(result.metadata.corpusTotals.samplesUsed).toBe(87);
    expect(result.metadata.subprocess.exitCode).toBe(0);
    expect(result.metadata.git).toBeUndefined();

    const modelfile = fs.readFile('/adapters/x/Modelfile');
    expect(modelfile).toContain(`FROM ${cfg.baseModelOllamaTag}`);
    expect(modelfile).toContain('ADAPTER ./adapters.safetensors');
    expect(modelfile).toContain('PARAMETER temperature');
  });

  it('includes git when provided', () => {
    const fs = createInMemoryFs();
    fs.mkdir('/adapters/y');
    const writer = new MetadataWriter(fs, () => new Date('2026-05-06T12:00:00Z'));
    const cfg = resolveConfig({});
    const result = writer.write({
      cfg,
      adapterPath: '/adapters/y',
      corpusManifestPath: '/c/manifest.json',
      corpusManifestSha256: 'b'.repeat(64),
      trainCount: 1,
      validCount: 0,
      testCount: 0,
      argv: ['python3'],
      exitCode: 0,
      elapsedMs: 1,
      timedOut: false,
      host: {},
      git: { branch: 'feat/x', sha: 'deadbeef', dirty: false },
      warnings: []
    });
    expect(result.metadata.git).toEqual({ branch: 'feat/x', sha: 'deadbeef', dirty: false });
  });
});

describe('configSha256', () => {
  it('is stable across identical configs', () => {
    const a = configSha256(resolveConfig({}));
    const b = configSha256(resolveConfig({}));
    expect(a).toBe(b);
  });

  it('changes when LoRA hyperparameter changes', () => {
    const a = configSha256(resolveConfig({ loraConfig: { rank: 8 } }));
    const b = configSha256(resolveConfig({ loraConfig: { rank: 16 } }));
    expect(a).not.toBe(b);
  });

  it('does NOT change when test seams change', () => {
    const a = configSha256(resolveConfig({}));
    const b = configSha256(
      resolveConfig({
        clock: () => new Date(),
        evalHarness: { evaluate: async () => ({ adapters: [], outputDir: '' }) }
      })
    );
    expect(a).toBe(b);
  });
});
