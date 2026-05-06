import { describe, expect, it } from 'vitest';
import { DigestWriter, renderBody } from '../src/digest.js';
import { createInMemoryFs } from './helpers/fakes.js';
import type { RegistryEntry } from '../src/types.js';

function makeCanary(): RegistryEntry {
  return {
    adapterName: 'qwen-c',
    adapterPath: '/a/qwen-c',
    metadataSha256: 'a'.repeat(64),
    configSha256: 'cfg',
    baseModel: 'mlx-community/Qwen2.5-Coder-7B-Instruct-4bit',
    baseModelOllamaTag: 'qwen2.5-coder:7b',
    status: 'canary',
    history: [],
    canaryPercent: 10,
    ollamaModelName: 'qwen2-5-coder-7b-canary-abc',
    registeredAt: '2026-05-06T00:00:00.000Z',
    promotedAt: '2026-05-06T00:00:00.000Z'
  };
}

describe('DigestWriter', () => {
  it('creates the file with a header on first append', () => {
    const fs = createInMemoryFs();
    const w = new DigestWriter(fs, '/reports/digest.md');
    w.appendEntry({ at: '2026-05-06T02:00:00Z', outcome: 'skipped-no-delta', body: 'no work' });
    expect(fs.exists('/reports/digest.md')).toBe(true);
    const content = fs.readFile('/reports/digest.md');
    expect(content).toContain('# Apprentice Retrainer — operator digest');
    expect(content).toContain('skipped (no corpus delta)');
  });

  it('appends to an existing file (preserves history)', () => {
    const fs = createInMemoryFs();
    const w = new DigestWriter(fs, '/reports/digest.md');
    w.appendEntry({ at: '2026-05-01T02:00:00Z', outcome: 'trained-and-canary-promoted', body: 'A' });
    w.appendEntry({ at: '2026-05-08T02:00:00Z', outcome: 'skipped-canary-active', body: 'B' });
    const content = fs.readFile('/reports/digest.md');
    expect(content).toContain('## 2026-05-01T02:00:00Z');
    expect(content).toContain('## 2026-05-08T02:00:00Z');
  });
});

describe('renderBody', () => {
  it('renders skipped-no-delta', () => {
    const md = renderBody({ kind: 'skipped-no-delta', deltaCount: 12, lastTrainAt: '2026-05-01T00:00:00Z' });
    expect(md).toContain('Delta: 12');
    expect(md).toContain('2026-05-01T00:00:00Z');
  });

  it('renders skipped-canary-active', () => {
    const md = renderBody({ kind: 'skipped-canary-active', canary: makeCanary(), daysHeld: 1 });
    expect(md).toContain('1 day(s)');
    expect(md).toContain('qwen-c');
  });

  it('renders trained-and-canary-promoted', () => {
    const md = renderBody({
      kind: 'trained-and-canary-promoted',
      adapterPath: '/a/x',
      canaryPercent: 10,
      evalReport: { name: 'x', winRate: 0.72, decision: 'promote-canary', regressionFlags: [] }
    });
    expect(md).toContain('promoted to canary');
    expect(md).toContain('10%');
    expect(md).toContain('0.720');
  });

  it('renders trained-and-rejected', () => {
    const md = renderBody({
      kind: 'trained-and-rejected',
      adapterPath: '/a/x',
      reason: 'eval winRate=0.45 below gate=0.60'
    });
    expect(md).toContain('rejected at eval gate');
    expect(md).toContain('eval winRate=0.45');
  });

  it('renders canary-held-prompting-operator', () => {
    const md = renderBody({ kind: 'canary-held-prompting-operator', canary: makeCanary(), daysHeld: 4 });
    expect(md).toContain('Operator action required');
    expect(md).toContain('promote-canary');
    expect(md).toContain('reject-canary');
  });

  it('renders failed', () => {
    const md = renderBody({ kind: 'failed', error: { message: 'boom', kind: 'TestError' } });
    expect(md).toContain('Retraining failed');
    expect(md).toContain('TestError');
    expect(md).toContain('boom');
  });
});
