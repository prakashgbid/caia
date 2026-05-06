import { describe, it, expect } from 'vitest';
import { ManifestReader } from '../src/manifest-reader.js';
import { createInMemoryFs, fixtureManifest, fixtureSample } from './helpers/fakes.js';
import { TrainingError } from '../src/types.js';

describe('ManifestReader.loadManifest', () => {
  it('reads a valid manifest and computes a stable sha256', () => {
    const m = fixtureManifest({ outputDir: '/corpora/2026-05-06', totalSamples: 87 });
    const fs = createInMemoryFs({
      '/corpora/2026-05-06/manifest.json': JSON.stringify(m)
    });
    const reader = new ManifestReader(fs);
    const { manifest, sha256 } = reader.loadManifest('/corpora/2026-05-06/manifest.json');
    expect(manifest.outputDir).toBe('/corpora/2026-05-06');
    expect(manifest.totals.final).toBe(87);
    expect(sha256).toMatch(/^[0-9a-f]{64}$/);
  });

  it('throws on missing manifest', () => {
    const fs = createInMemoryFs();
    const reader = new ManifestReader(fs);
    expect(() => reader.loadManifest('/missing/manifest.json')).toThrow(TrainingError);
  });

  it('throws on invalid JSON', () => {
    const fs = createInMemoryFs({ '/m.json': '{not json' });
    const reader = new ManifestReader(fs);
    expect(() => reader.loadManifest('/m.json')).toThrow(/Failed to parse corpus manifest/);
  });

  it('throws on missing required fields', () => {
    const fs = createInMemoryFs({ '/m.json': JSON.stringify({ version: 1 }) });
    const reader = new ManifestReader(fs);
    expect(() => reader.loadManifest('/m.json')).toThrow(/Corpus manifest/);
  });

  it('throws when holdout is not a string array', () => {
    const fs = createInMemoryFs({
      '/m.json': JSON.stringify({
        version: 1,
        outputDir: '/c',
        totals: { final: 10 },
        holdout: 'not-an-array'
      })
    });
    const reader = new ManifestReader(fs);
    expect(() => reader.loadManifest('/m.json')).toThrow(/Corpus manifest/);
  });

  it('accepts manifests without a holdout field (older Phase 0 corpora)', () => {
    const m = fixtureManifest({ outputDir: '/c', totalSamples: 10 });
    delete (m as Record<string, unknown>).holdout;
    const fs = createInMemoryFs({ '/m.json': JSON.stringify(m) });
    const reader = new ManifestReader(fs);
    expect(() => reader.loadManifest('/m.json')).not.toThrow();
  });
});

describe('ManifestReader.resolveSamplesPath', () => {
  it('returns absolute path when outputDir is absolute', () => {
    const fs = createInMemoryFs();
    const reader = new ManifestReader(fs);
    const m = fixtureManifest({ outputDir: '/abs/out', totalSamples: 1 });
    expect(reader.resolveSamplesPath('/some/manifest.json', m)).toBe('/abs/out/samples.jsonl');
  });

  it('resolves relative outputDir against the manifest path', () => {
    const fs = createInMemoryFs();
    const reader = new ManifestReader(fs);
    const m = fixtureManifest({ outputDir: 'relative-dir', totalSamples: 1 });
    expect(reader.resolveSamplesPath('/parent/manifest.json', m)).toBe('/parent/relative-dir/samples.jsonl');
  });
});

describe('ManifestReader.loadSamples', () => {
  it('reads valid jsonl', () => {
    const lines = [fixtureSample('a'), fixtureSample('b')]
      .map(s => JSON.stringify(s))
      .join('\n');
    const fs = createInMemoryFs({ '/s.jsonl': lines });
    const reader = new ManifestReader(fs);
    const samples = reader.loadSamples('/s.jsonl');
    expect(samples.length).toBe(2);
    expect(samples[0]?.id).toBe('a');
  });

  it('tolerates trailing blank lines', () => {
    const fs = createInMemoryFs({
      '/s.jsonl': JSON.stringify(fixtureSample('a')) + '\n\n\n'
    });
    const reader = new ManifestReader(fs);
    expect(reader.loadSamples('/s.jsonl').length).toBe(1);
  });

  it('throws on schema-invalid lines', () => {
    const fs = createInMemoryFs({
      '/s.jsonl': JSON.stringify({ id: 'x' /* messages missing */ })
    });
    const reader = new ManifestReader(fs);
    expect(() => reader.loadSamples('/s.jsonl')).toThrow(/expected sample shape/);
  });

  it('throws on parse errors', () => {
    const fs = createInMemoryFs({ '/s.jsonl': '{bad json}\n' });
    const reader = new ManifestReader(fs);
    expect(() => reader.loadSamples('/s.jsonl')).toThrow(/is not valid JSON/);
  });

  it('throws on missing samples file', () => {
    const fs = createInMemoryFs();
    const reader = new ManifestReader(fs);
    expect(() => reader.loadSamples('/missing.jsonl')).toThrow(/Corpus samples.jsonl not found/);
  });
});
