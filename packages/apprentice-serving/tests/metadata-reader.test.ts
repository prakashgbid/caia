import { describe, expect, it } from 'vitest';
import { readAdapterArtifacts, extractEvalSummary } from '../src/metadata-reader.js';
import { AdapterNotFoundError, MetadataMalformedError } from '../src/types.js';
import { createInMemoryFs, fixtureAdapter } from './helpers/fakes.js';

describe('readAdapterArtifacts', () => {
  it('reads a complete adapter directory', () => {
    const fs = createInMemoryFs();
    fixtureAdapter(fs, { adapterPath: '/tmp/adapters/2026-05-06-test' });
    const out = readAdapterArtifacts(fs, '/tmp/adapters/2026-05-06-test');
    expect(out.metadata.baseModel).toBe('mlx-community/Qwen2.5-Coder-7B-Instruct-4bit');
    expect(out.metadata.baseModelOllamaTag).toBe('qwen2.5-coder:7b');
    expect(out.metadataSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(out.modelfilePath).toBe('/tmp/adapters/2026-05-06-test/Modelfile');
    expect(out.adapterFile).toBe('/tmp/adapters/2026-05-06-test/adapters.safetensors');
  });

  it('throws AdapterNotFoundError when adapterPath does not exist', () => {
    const fs = createInMemoryFs();
    expect(() => readAdapterArtifacts(fs, '/nonexistent')).toThrow(AdapterNotFoundError);
  });

  it('throws AdapterNotFoundError when a mandatory file is missing', () => {
    const fs = createInMemoryFs();
    fs.putDir('/tmp/incomplete');
    fs.put('/tmp/incomplete/Modelfile', 'FROM x\n');
    expect(() => readAdapterArtifacts(fs, '/tmp/incomplete')).toThrow(AdapterNotFoundError);
  });

  it('throws MetadataMalformedError on malformed JSON', () => {
    const fs = createInMemoryFs();
    fixtureAdapter(fs, { adapterPath: '/tmp/bad' });
    fs.put('/tmp/bad/training-metadata.json', '{ not json');
    expect(() => readAdapterArtifacts(fs, '/tmp/bad')).toThrow(MetadataMalformedError);
  });

  it('throws MetadataMalformedError when required fields missing', () => {
    const fs = createInMemoryFs();
    fixtureAdapter(fs, { adapterPath: '/tmp/missing' });
    fs.put(
      '/tmp/missing/training-metadata.json',
      JSON.stringify({ version: 1, generatedAt: 'x' })
    );
    expect(() => readAdapterArtifacts(fs, '/tmp/missing')).toThrow(MetadataMalformedError);
  });

  it('produces deterministic metadataSha256 over identical content', () => {
    const fs1 = createInMemoryFs();
    const fs2 = createInMemoryFs();
    fixtureAdapter(fs1, {
      adapterPath: '/tmp/a',
      configSha256: 'fixed',
      metadataExtras: { generatedAt: '2026-05-06T00:00:00.000Z' }
    });
    fixtureAdapter(fs2, {
      adapterPath: '/tmp/b',
      configSha256: 'fixed',
      metadataExtras: { generatedAt: '2026-05-06T00:00:00.000Z' }
    });
    const a = readAdapterArtifacts(fs1, '/tmp/a').metadataSha256;
    const b = readAdapterArtifacts(fs2, '/tmp/b').metadataSha256;
    expect(a).toBe(b);
  });

  it('attaches evalReport when eval-report.json present', () => {
    const fs = createInMemoryFs();
    fixtureAdapter(fs, {
      adapterPath: '/tmp/with-eval',
      evalReport: { winRate: 0.7, decision: 'promote-canary', regressionFlags: [] }
    });
    const out = readAdapterArtifacts(fs, '/tmp/with-eval');
    expect(out.evalReport).toBeDefined();
    expect(out.evalReport!.winRate).toBe(0.7);
    expect(out.evalReport!.decision).toBe('promote-canary');
  });

  it('tolerates missing eval-report.json', () => {
    const fs = createInMemoryFs();
    fixtureAdapter(fs, { adapterPath: '/tmp/no-eval' });
    const out = readAdapterArtifacts(fs, '/tmp/no-eval');
    expect(out.evalReport).toBeUndefined();
  });

  it('tolerates malformed eval-report.json (treats as absent)', () => {
    const fs = createInMemoryFs();
    fixtureAdapter(fs, { adapterPath: '/tmp/bad-eval' });
    fs.put('/tmp/bad-eval/eval-report.json', 'not-json');
    const out = readAdapterArtifacts(fs, '/tmp/bad-eval');
    expect(out.evalReport).toBeUndefined();
  });
});

describe('extractEvalSummary', () => {
  it('returns the first adapter entry verbatim', () => {
    const summary = extractEvalSummary({
      adapters: [
        { name: 'x', winRate: 0.65, decision: 'promote-canary', regressionFlags: ['f1'] }
      ]
    });
    expect(summary).toEqual({ winRate: 0.65, decision: 'promote-canary', regressionFlags: ['f1'] });
  });

  it('returns undefined for empty / missing adapters array', () => {
    expect(extractEvalSummary({})).toBeUndefined();
    expect(extractEvalSummary({ adapters: [] })).toBeUndefined();
  });

  it('returns undefined when winRate is non-numeric', () => {
    expect(
      extractEvalSummary({
        adapters: [{ name: 'x', decision: 'promote-canary' }]
      })
    ).toBeUndefined();
  });

  it('defaults regressionFlags to empty array', () => {
    const summary = extractEvalSummary({
      adapters: [{ winRate: 0.5, decision: 'baseline' }]
    });
    expect(summary).toBeDefined();
    expect(summary!.regressionFlags).toEqual([]);
  });
});
