import { describe, it, expect } from 'vitest';
import { parseDiff, chunkHunk, walkHunk } from '../src/diff-parser.js';

describe('parseDiff', () => {
  it('parses a single-file modified diff', () => {
    const diff = [
      'diff --git a/src/foo.ts b/src/foo.ts',
      'index 1234567..abcdefg 100644',
      '--- a/src/foo.ts',
      '+++ b/src/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' export const x = 1;',
      '+export const y = 2;',
      ' export const z = 3;',
      ' export const w = 4;'
    ].join('\n');
    const parsed = parseDiff(diff);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].file).toBe('src/foo.ts');
    expect(parsed.hunks[0].status).toBe('modified');
    expect(parsed.hunks[0].oldStart).toBe(1);
    expect(parsed.hunks[0].newStart).toBe(1);
    expect(parsed.fileCount).toBe(1);
  });

  it('parses an added file', () => {
    const diff = [
      'diff --git a/src/new.ts b/src/new.ts',
      'new file mode 100644',
      'index 0000000..1234567',
      '--- /dev/null',
      '+++ b/src/new.ts',
      '@@ -0,0 +1,2 @@',
      '+export const x = 1;',
      '+export const y = 2;'
    ].join('\n');
    const parsed = parseDiff(diff);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].status).toBe('added');
  });

  it('parses a deleted file', () => {
    const diff = [
      'diff --git a/src/gone.ts b/src/gone.ts',
      'deleted file mode 100644',
      '--- a/src/gone.ts',
      '+++ /dev/null',
      '@@ -1,2 +0,0 @@',
      '-export const x = 1;',
      '-export const y = 2;'
    ].join('\n');
    const parsed = parseDiff(diff);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].status).toBe('deleted');
  });

  it('parses a renamed file', () => {
    const diff = [
      'diff --git a/src/old.ts b/src/new.ts',
      'similarity index 90%',
      'rename from src/old.ts',
      'rename to src/new.ts',
      '--- a/src/old.ts',
      '+++ b/src/new.ts',
      '@@ -1,2 +1,2 @@',
      ' export const x = 1;',
      '-export const y = 2;',
      '+export const y = 22;'
    ].join('\n');
    const parsed = parseDiff(diff);
    expect(parsed.hunks).toHaveLength(1);
    expect(parsed.hunks[0].status).toBe('renamed');
    expect(parsed.hunks[0].file).toBe('src/new.ts');
  });

  it('skips binary files', () => {
    const diff = [
      'diff --git a/img.png b/img.png',
      'Binary files a/img.png and b/img.png differ'
    ].join('\n');
    const parsed = parseDiff(diff);
    expect(parsed.hunks).toHaveLength(0);
  });

  it('parses multi-file diff', () => {
    const diff = [
      'diff --git a/a.ts b/a.ts',
      '--- a/a.ts',
      '+++ b/a.ts',
      '@@ -1,1 +1,2 @@',
      ' a',
      '+b',
      'diff --git a/b.ts b/b.ts',
      '--- a/b.ts',
      '+++ b/b.ts',
      '@@ -1,1 +1,2 @@',
      ' x',
      '+y'
    ].join('\n');
    const parsed = parseDiff(diff);
    expect(parsed.hunks).toHaveLength(2);
    expect(parsed.fileCount).toBe(2);
  });

  it('returns empty for empty diff', () => {
    const parsed = parseDiff('');
    expect(parsed.hunks).toHaveLength(0);
    expect(parsed.fileCount).toBe(0);
  });
});

describe('chunkHunk', () => {
  it('returns the hunk as-is when body is small', () => {
    const hunk = {
      file: 'a.ts',
      oldStart: 1,
      newStart: 1,
      header: '@@ -1,1 +1,1 @@',
      body: ' a\n+b',
      status: 'modified' as const
    };
    expect(chunkHunk(hunk, 1000)).toEqual([hunk]);
  });

  it('splits when body exceeds maxBytes', () => {
    const body = Array.from({ length: 50 }, (_, i) => ` line${i}`).join('\n');
    const hunk = {
      file: 'a.ts',
      oldStart: 1,
      newStart: 1,
      header: '@@ -1,50 +1,50 @@',
      body,
      status: 'modified' as const
    };
    const chunks = chunkHunk(hunk, 100);
    expect(chunks.length).toBeGreaterThan(1);
    // First chunk keeps original header
    expect(chunks[0].header).toBe('@@ -1,50 +1,50 @@');
    // Subsequent chunks are marked
    expect(chunks[1].header).toMatch(/\(chunked\)/);
  });
});

describe('walkHunk', () => {
  it('emits one entry per body line with correct line numbers', () => {
    const hunk = {
      file: 'a.ts',
      oldStart: 10,
      newStart: 10,
      header: '@@ -10,2 +10,3 @@',
      body: ' a\n+b\n c',
      status: 'modified' as const
    };
    const lines = walkHunk(hunk);
    expect(lines).toHaveLength(3);
    expect(lines[0]).toEqual({ kind: ' ', newLine: 10, oldLine: 10, text: 'a' });
    expect(lines[1]).toEqual({ kind: '+', newLine: 11, oldLine: -1, text: 'b' });
    expect(lines[2]).toEqual({ kind: ' ', newLine: 12, oldLine: 11, text: 'c' });
  });

  it('handles deletions', () => {
    const hunk = {
      file: 'a.ts',
      oldStart: 10,
      newStart: 10,
      header: '@@',
      body: ' a\n-b',
      status: 'modified' as const
    };
    const lines = walkHunk(hunk);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toEqual({ kind: '-', newLine: -1, oldLine: 11, text: 'b' });
  });
});
