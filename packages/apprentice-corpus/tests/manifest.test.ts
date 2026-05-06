import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildManifest, hashConfig, writeCorpus } from '../src/manifest.js';
import type { InstructionPair, RawArtifact } from '../src/types.js';

const baseInputs = (outputDir: string) => ({
  outputDir,
  rawArtifacts: [
    {
      source: 'memory' as const,
      sourceId: '/x.md',
      kind: 'directive',
      text: 'a'.repeat(200),
      createdAtMs: 0
    },
    {
      source: 'events' as const,
      sourceId: 'e-1',
      kind: 'TaskCompleted',
      text: 'b'.repeat(200),
      createdAtMs: 0
    }
  ] satisfies RawArtifact[],
  finalPairs: [
    {
      id: 'h1',
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a'.repeat(200) }
      ],
      meta: {
        source: 'memory',
        sourceId: '/x.md',
        kind: 'directive',
        qualityScore: 0.65,
        distilled: false,
        redactedSpans: ['email'],
        createdAt: '2026-05-06T00:00:00Z',
        contentSha256: 'h1'
      }
    }
  ] satisfies InstructionPair[],
  dropped: [
    { source: 'events' as const, sourceId: 'e-1', reason: 'too-short' as const }
  ],
  totals: {
    rawArtifacts: 2,
    afterDedup: 2,
    afterPII: 2,
    afterQuality: 1,
    distilled: 0,
    dropped: 1,
    final: 1
  },
  warnings: ['langfuse disabled'],
  configHash: hashConfig('{"memoryRoot":"/x"}'),
  generatedAt: '2026-05-06T00:00:00Z',
  elapsedMs: 1234,
  holdoutIds: []
});

describe('buildManifest', () => {
  it('counts artifacts + samples per source', () => {
    const m = buildManifest(baseInputs('/tmp/x'));
    expect(m.perSource.memory.artifacts).toBe(1);
    expect(m.perSource.memory.samples).toBe(1);
    expect(m.perSource.events.artifacts).toBe(1);
    expect(m.perSource.events.samples).toBe(0);
  });

  it('builds quality histogram', () => {
    const m = buildManifest(baseInputs('/tmp/x'));
    expect(m.qualityHistogram['0.6-0.8']).toBe(1);
    expect(m.qualityHistogram['0.0-0.2']).toBe(0);
  });

  it('builds redactedSpans histogram', () => {
    const m = buildManifest(baseInputs('/tmp/x'));
    expect(m.redactedSpansHistogram['email']).toBe(1);
  });
});

describe('writeCorpus', () => {
  it('writes all 5 files to outputDir', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'apprentice-corpus-test-'));
    try {
      const inputs = baseInputs(tmp);
      writeCorpus(inputs, '{"memoryRoot":"/x"}');
      const samples = readFileSync(join(tmp, 'samples.jsonl'), 'utf-8');
      expect(samples.split('\n').filter((l) => l !== '').length).toBe(1);
      const sources = JSON.parse(readFileSync(join(tmp, 'sources.json'), 'utf-8'));
      expect(Array.isArray(sources)).toBe(true);
      expect(sources.length).toBe(2);
      const dropped = readFileSync(join(tmp, 'dropped.jsonl'), 'utf-8');
      expect(dropped).toContain('too-short');
      const config = readFileSync(join(tmp, 'config.json'), 'utf-8');
      expect(config).toContain('memoryRoot');
      const manifest = JSON.parse(readFileSync(join(tmp, 'manifest.json'), 'utf-8'));
      expect(manifest.version).toBe(1);
      expect(manifest.totals.final).toBe(1);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('writes empty files when there is no corpus', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'apprentice-corpus-test-'));
    try {
      const inputs = {
        ...baseInputs(tmp),
        rawArtifacts: [],
        finalPairs: [],
        dropped: [],
        totals: {
          rawArtifacts: 0,
          afterDedup: 0,
          afterPII: 0,
          afterQuality: 0,
          distilled: 0,
          dropped: 0,
          final: 0
        }
      };
      writeCorpus(inputs, '{}');
      expect(readFileSync(join(tmp, 'samples.jsonl'), 'utf-8')).toBe('');
      expect(readFileSync(join(tmp, 'dropped.jsonl'), 'utf-8')).toBe('');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
