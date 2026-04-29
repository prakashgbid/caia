import { describe, it, expect } from 'vitest';
import { chunkFile } from '../src/chunker.js';

describe('chunkFile', () => {
  it('returns no chunks for empty content', () => {
    expect(chunkFile('a.ts', '')).toEqual([]);
    expect(chunkFile('a.ts', '\n')).toEqual([]);
  });

  it('produces one chunk for short files', () => {
    const text = ['a', 'b', 'c'].join('\n');
    const chunks = chunkFile('a.ts', text, {
      chunkLines: 60,
      overlapLines: 10,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.path).toBe('a.ts');
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(3);
    expect(chunks[0]!.content).toContain('[a.ts L1-3]');
    expect(chunks[0]!.content).toContain('a\nb\nc');
  });

  it('splits long files with the configured stride', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line-${i + 1}`);
    const chunks = chunkFile('big.ts', lines.join('\n'), {
      chunkLines: 30,
      overlapLines: 5,
    });
    // stride = chunkLines - overlap = 25 -> chunks at 1, 26, 51, 76 -> 4
    expect(chunks).toHaveLength(4);
    expect(chunks[0]!.startLine).toBe(1);
    expect(chunks[0]!.endLine).toBe(30);
    expect(chunks[1]!.startLine).toBe(26);
    expect(chunks[1]!.endLine).toBe(55);
    expect(chunks[3]!.endLine).toBe(100);
  });

  it('clamps overlap below chunk size', () => {
    const lines = Array.from({ length: 10 }, (_, i) => `l-${i}`);
    const chunks = chunkFile('a.ts', lines.join('\n'), {
      chunkLines: 5,
      overlapLines: 100,
    });
    // overlap is clamped to chunkLines-1 = 4, stride = 1
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.endLine - c.startLine).toBeLessThanOrEqual(5);
    }
  });

  it('produces stable ids — same input yields same id', () => {
    const text = 'a\nb\nc';
    const a = chunkFile('a.ts', text)[0]!;
    const b = chunkFile('a.ts', text)[0]!;
    expect(a.id).toBe(b.id);
    expect(a.id).toMatch(/^[a-f0-9]{64}$/);
  });

  it('produces different ids for different paths', () => {
    const text = 'a\nb';
    const a = chunkFile('one.ts', text)[0]!;
    const b = chunkFile('two.ts', text)[0]!;
    expect(a.id).not.toBe(b.id);
  });

  it('prepends a contextual header with file path + line range', () => {
    const text = Array.from({ length: 20 }, (_, i) => `x${i}`).join('\n');
    const chunks = chunkFile('packages/foo/bar.ts', text, {
      chunkLines: 10,
      overlapLines: 0,
    });
    expect(chunks[0]!.content.startsWith('[packages/foo/bar.ts L1-10]\n'))
      .toBe(true);
    expect(chunks[1]!.content.startsWith('[packages/foo/bar.ts L11-20]\n'))
      .toBe(true);
  });
});
