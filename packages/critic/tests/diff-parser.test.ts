import { describe, it, expect } from 'vitest';

import { parseDiff, chunkHunk, walkHunk } from '../src/diff-parser.js';

const SIMPLE_DIFF = `diff --git a/foo.ts b/foo.ts
index 1..2 100644
--- a/foo.ts
+++ b/foo.ts
@@ -1,3 +1,4 @@
 export const x = 1;
+export const y = 2;
 export const z = 3;
-export const w = 4;
`;

const ADDED_FILE_DIFF = `diff --git a/new.ts b/new.ts
new file mode 100644
index 0..1
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+const a = 1;
+const b = 2;
`;

const DELETED_DIFF = `diff --git a/gone.ts b/gone.ts
deleted file mode 100644
index 1..0
--- a/gone.ts
+++ /dev/null
@@ -1,2 +0,0 @@
-const a = 1;
-const b = 2;
`;

const BINARY_DIFF = `diff --git a/img.png b/img.png
index 1..2 100644
Binary files a/img.png and b/img.png differ
diff --git a/text.ts b/text.ts
index 1..2 100644
--- a/text.ts
+++ b/text.ts
@@ -1 +1 @@
-old
+new
`;

describe('parseDiff', () => {
  it('parses a simple modify-hunk', () => {
    const r = parseDiff(SIMPLE_DIFF);
    expect(r.hunks).toHaveLength(1);
    expect(r.hunks[0]?.file).toBe('foo.ts');
    expect(r.hunks[0]?.status).toBe('modified');
    expect(r.hunks[0]?.oldStart).toBe(1);
    expect(r.hunks[0]?.newStart).toBe(1);
    expect(r.fileCount).toBe(1);
  });

  it('marks added files', () => {
    const r = parseDiff(ADDED_FILE_DIFF);
    expect(r.hunks[0]?.status).toBe('added');
  });

  it('marks deleted files', () => {
    const r = parseDiff(DELETED_DIFF);
    expect(r.hunks[0]?.status).toBe('deleted');
  });

  it('skips binary diffs', () => {
    const r = parseDiff(BINARY_DIFF);
    expect(r.hunks).toHaveLength(1);
    expect(r.hunks[0]?.file).toBe('text.ts');
  });

  it('handles empty diff', () => {
    const r = parseDiff('');
    expect(r.hunks).toHaveLength(0);
    expect(r.fileCount).toBe(0);
  });
});

describe('walkHunk', () => {
  it('emits added/removed/context with correct line numbers', () => {
    const r = parseDiff(SIMPLE_DIFF);
    const lines = walkHunk(r.hunks[0]!);
    const added = lines.filter(l => l.kind === '+');
    const removed = lines.filter(l => l.kind === '-');
    expect(added).toHaveLength(1);
    expect(added[0]?.text).toBe('export const y = 2;');
    expect(added[0]?.newLine).toBe(2);
    expect(removed[0]?.text).toBe('export const w = 4;');
  });
});

describe('chunkHunk', () => {
  it('returns the same hunk when under maxBytes', () => {
    const r = parseDiff(SIMPLE_DIFF);
    const chunks = chunkHunk(r.hunks[0]!, 100_000);
    expect(chunks).toHaveLength(1);
  });

  it('splits when over maxBytes', () => {
    const big = parseDiff(SIMPLE_DIFF).hunks[0]!;
    const massive = {
      ...big,
      body: Array.from({ length: 100 }, (_, i) => `+const a${i} = ${i};`).join('\n')
    };
    const chunks = chunkHunk(massive, 200);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]?.header).toContain('chunked');
  });
});
