import { describe, expect, it } from 'vitest';
import { parseDiff, chunkHunk, walkHunk } from '../src/diff-parser.js';
import type { DiffHunk } from '../src/types.js';

describe('parseDiff', () => {
  it('parses a single-file added diff', () => {
    const diff = [
      'diff --git a/src/x.ts b/src/x.ts',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/src/x.ts',
      '@@ -0,0 +1,2 @@',
      '+const a = 1;',
      '+const b = 2;'
    ].join('\n');
    const out = parseDiff(diff);
    expect(out.hunks).toHaveLength(1);
    expect(out.hunks[0]?.file).toBe('src/x.ts');
    expect(out.hunks[0]?.status).toBe('added');
    expect(out.fileCount).toBe(1);
  });

  it('parses a multi-hunk modified diff', () => {
    const diff = [
      'diff --git a/src/y.ts b/src/y.ts',
      '--- a/src/y.ts',
      '+++ b/src/y.ts',
      '@@ -10,1 +10,2 @@',
      ' kept',
      '+added',
      '@@ -50,2 +51,1 @@',
      '-removed',
      ' kept'
    ].join('\n');
    const out = parseDiff(diff);
    expect(out.hunks).toHaveLength(2);
    expect(out.hunks[0]?.newStart).toBe(10);
    expect(out.hunks[1]?.newStart).toBe(51);
  });

  it('skips binary diffs', () => {
    const diff = [
      'diff --git a/src/img.png b/src/img.png',
      'Binary files a/src/img.png and b/src/img.png differ'
    ].join('\n');
    expect(parseDiff(diff).hunks).toHaveLength(0);
  });
});

describe('walkHunk', () => {
  it('emits new/old line numbers correctly', () => {
    const hunk: DiffHunk = {
      file: 'a.ts',
      oldStart: 1,
      newStart: 1,
      header: '@@ -1,2 +1,3 @@',
      body: ' kept\n+added\n-removed',
      status: 'modified'
    };
    const out = walkHunk(hunk);
    expect(out).toEqual([
      { kind: ' ', newLine: 1, oldLine: 1, text: 'kept' },
      { kind: '+', newLine: 2, oldLine: -1, text: 'added' },
      { kind: '-', newLine: -1, oldLine: 2, text: 'removed' }
    ]);
  });
});

describe('chunkHunk', () => {
  it('returns single-element array when within budget', () => {
    const hunk: DiffHunk = {
      file: 'a.ts', oldStart: 1, newStart: 1,
      header: '@@', body: '+a\n+b', status: 'added'
    };
    expect(chunkHunk(hunk, 1000)).toHaveLength(1);
  });

  it('splits when over budget', () => {
    const body = Array.from({ length: 50 }, (_, i) => `+line ${i}`).join('\n');
    const hunk: DiffHunk = {
      file: 'a.ts', oldStart: 1, newStart: 1,
      header: '@@', body, status: 'added'
    };
    const chunks = chunkHunk(hunk, 80);
    expect(chunks.length).toBeGreaterThan(1);
    // Total bytes preserved.
    const total = chunks.map(c => c.body).join('\n');
    expect(total).toContain('line 0');
    expect(total).toContain('line 49');
  });
});
