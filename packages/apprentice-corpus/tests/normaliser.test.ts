import { describe, expect, it } from 'vitest';

import {
  buildResponse,
  instructionFor,
  normaliseAll,
  normaliseOne,
  sha256OfMessages
} from '../src/normaliser.js';
import type { RawArtifact } from '../src/types.js';

const fixedClock = () => new Date('2026-05-06T01:23:42Z');

describe('instructionFor', () => {
  it('routes by source + kind', () => {
    expect(
      instructionFor({
        source: 'memory',
        sourceId: 'x',
        kind: 'directive',
        text: 't',
        createdAtMs: 0
      })
    ).toMatch(/standing rule/i);
    expect(
      instructionFor({
        source: 'events',
        sourceId: 'x',
        kind: 'PRMerged',
        text: 't',
        createdAtMs: 0
      })
    ).toMatch(/PR was merged/i);
  });
});

describe('buildResponse', () => {
  it('truncates at last paragraph break before cap', () => {
    const text = 'a'.repeat(50) + '\n\n' + 'b'.repeat(50);
    const r = buildResponse(
      { source: 'memory', sourceId: 'x', text, createdAtMs: 0 },
      80
    );
    expect(r.length).toBeLessThanOrEqual(80);
    expect(r).toBe('a'.repeat(50));
  });
  it('hard-cuts when no good break found', () => {
    const text = 'a'.repeat(200);
    const r = buildResponse(
      { source: 'memory', sourceId: 'x', text, createdAtMs: 0 },
      50
    );
    expect(r.length).toBe(50);
  });
  it('returns full text when under cap', () => {
    const r = buildResponse(
      { source: 'memory', sourceId: 'x', text: 'short', createdAtMs: 0 },
      100
    );
    expect(r).toBe('short');
  });
});

describe('normaliseOne', () => {
  it('produces system+user+assistant turn', () => {
    const a: RawArtifact = {
      source: 'memory',
      sourceId: 'feedback_x.md',
      kind: 'feedback',
      text: 'a'.repeat(200),
      createdAtMs: 0
    };
    const p = normaliseOne(a, {
      minSampleLengthChars: 80,
      maxSampleLengthChars: 1000,
      clock: fixedClock
    });
    expect(p).not.toBeNull();
    expect(p?.messages.length).toBe(3);
    expect(p?.messages[0]?.role).toBe('system');
    expect(p?.messages[1]?.role).toBe('user');
    expect(p?.messages[2]?.role).toBe('assistant');
    expect(p?.meta.source).toBe('memory');
    expect(p?.meta.kind).toBe('feedback');
    expect(p?.id).toBe(p?.meta.contentSha256);
  });

  it('drops too-short artifacts', () => {
    const a: RawArtifact = {
      source: 'memory',
      sourceId: 'x.md',
      kind: 'feedback',
      text: 'tiny',
      createdAtMs: 0
    };
    const p = normaliseOne(a, {
      minSampleLengthChars: 80,
      maxSampleLengthChars: 1000,
      clock: fixedClock
    });
    expect(p).toBeNull();
  });
});

describe('normaliseAll', () => {
  it('partitions kept and dropped', () => {
    const arts: RawArtifact[] = [
      { source: 'memory', sourceId: 'a.md', kind: 'feedback', text: 'x'.repeat(200), createdAtMs: 0 },
      { source: 'memory', sourceId: 'b.md', kind: 'feedback', text: 'short', createdAtMs: 0 }
    ];
    const r = normaliseAll(arts, {
      minSampleLengthChars: 80,
      maxSampleLengthChars: 1000,
      clock: fixedClock
    });
    expect(r.kept.length).toBe(1);
    expect(r.droppedSourceIds.length).toBe(1);
    expect(r.droppedSourceIds[0]?.reason).toBe('too-short');
  });
});

describe('sha256OfMessages', () => {
  it('is deterministic', () => {
    const m = [
      { role: 'system' as const, content: 's' },
      { role: 'user' as const, content: 'u' },
      { role: 'assistant' as const, content: 'a' }
    ];
    expect(sha256OfMessages(m)).toBe(sha256OfMessages(m));
    // Length 64 hex
    expect(sha256OfMessages(m)).toMatch(/^[0-9a-f]{64}$/);
  });
});
