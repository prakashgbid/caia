import { describe, it, expect } from 'vitest';

import { generateDigest, DigestSizeExceededError } from '../src/digest.js';
import type { Finding, FindingSource } from '../src/types.js';

function findingFx(over: Partial<Finding> = {}): Finding {
  return {
    id: 'f1',
    source: 'memory',
    kind: 'memory-updated',
    key: 'feedback_x.md',
    title: 'feedback_x.md updated',
    tsIso: '2026-05-09T01:00:00.000Z',
    importance: 0.7,
    tags: ['feedback'],
    ...over
  };
}

const sourceSummary: Record<FindingSource, { collected: number; warnings: readonly string[] }> = {
  pr: { collected: 0, warnings: [] },
  memory: { collected: 1, warnings: [] },
  transcript: { collected: 0, warnings: [] },
  'connector-error': { collected: 0, warnings: [] }
};

describe('digest', () => {
  it('renders a non-empty markdown digest', () => {
    const d = generateDigest({
      findings: [findingFx()],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary
    });
    expect(d.markdown).toContain('# Surface Digest');
    expect(d.markdown).toContain('feedback_x.md updated');
    expect(d.findings.length).toBe(1);
    expect(d.sizeBytes).toBe(Buffer.byteLength(d.markdown, 'utf-8'));
  });

  it('groups findings by source in section order', () => {
    const d = generateDigest({
      findings: [
        findingFx({ id: '1', source: 'pr', kind: 'pr-merged', title: 'PR #1 merged' }),
        findingFx({ id: '2', source: 'memory', title: 'mem' }),
        findingFx({ id: '3', source: 'transcript', kind: 'transcript-handoff', title: 'tx' })
      ],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary: {
        pr: { collected: 1, warnings: [] },
        memory: { collected: 1, warnings: [] },
        transcript: { collected: 1, warnings: [] },
        'connector-error': { collected: 0, warnings: [] }
      }
    });
    const prIdx = d.markdown.indexOf('## Pull Requests');
    const memIdx = d.markdown.indexOf('## Agent Memory');
    const txIdx = d.markdown.indexOf('## Agent Transcripts');
    expect(prIdx).toBeGreaterThan(0);
    expect(memIdx).toBeGreaterThan(prIdx);
    expect(txIdx).toBeGreaterThan(memIdx);
  });

  it('throws DigestSizeExceededError when over cap', () => {
    const findings: Finding[] = [];
    for (let i = 0; i < 1000; i++) {
      findings.push(findingFx({
        id: `i${i}`,
        title: 'x'.repeat(1000)
      }));
    }
    expect(() => generateDigest({
      findings,
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 5000,
      sourceSummary
    })).toThrow(DigestSizeExceededError);
  });

  it('shows source warnings in summary', () => {
    const ss: typeof sourceSummary = {
      ...sourceSummary,
      pr: { collected: 0, warnings: ['rate-limit hit'] }
    };
    const d = generateDigest({
      findings: [],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary: ss
    });
    expect(d.markdown).toContain('rate-limit hit');
  });

  it('renders findings in given order (caller pre-sorts)', () => {
    const d = generateDigest({
      findings: [
        findingFx({ id: 'b', title: 'second' }),
        findingFx({ id: 'a', title: 'first' })
      ],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary
    });
    const idxFirst = d.markdown.indexOf('first');
    const idxSecond = d.markdown.indexOf('second');
    expect(idxSecond).toBeGreaterThan(0);
    expect(idxFirst).toBeGreaterThan(idxSecond);
  });

  it('shows "no findings" message when empty', () => {
    const d = generateDigest({
      findings: [],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary
    });
    expect(d.markdown).toContain('No findings');
  });

  it('renders finding URL as a markdown link', () => {
    const d = generateDigest({
      findings: [findingFx({ url: 'https://x.test/pr/1' })],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary
    });
    expect(d.markdown).toContain('https://x.test/pr/1');
  });

  it('determinism: same input → identical markdown', () => {
    const args = {
      findings: [findingFx()],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary
    } as const;
    const d1 = generateDigest({ ...args });
    const d2 = generateDigest({ ...args });
    expect(d1.markdown).toBe(d2.markdown);
  });

  it('escapes pipe characters in titles', () => {
    const d = generateDigest({
      findings: [findingFx({ title: 'has | pipe' })],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary
    });
    expect(d.markdown).toContain('has \\| pipe');
  });

  it('size is reported truthfully', () => {
    const d = generateDigest({
      findings: [findingFx()],
      dropped: [],
      generatedAtIso: '2026-05-09T12:00:00.000Z',
      sinceIso: '2026-05-08T00:00:00.000Z',
      untilIso: '2026-05-09T00:00:00.000Z',
      maxBytes: 50_000,
      sourceSummary
    });
    expect(d.sizeBytes).toBe(Buffer.byteLength(d.markdown, 'utf-8'));
    expect(d.sizeBytes).toBeLessThan(50_000);
  });
});
