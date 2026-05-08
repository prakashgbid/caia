/**
 * Unified-diff parser — pure functions, no I/O.
 *
 * Mirrors the shape used by `@chiefaia/critic` and `@chiefaia/reviewer` —
 * intentional, all three agents share the same pre-processing path so the
 * two-tier detector pattern is uniform across the agent fleet.
 *
 * Handles GitHub-style unified diff produced by `git diff` / `gh pr diff`:
 *   - `diff --git a/<path> b/<path>` separator lines
 *   - `--- a/<path>` / `+++ b/<path>` file headers
 *   - `@@ -<oldStart>,<oldLen> +<newStart>,<newLen> @@` hunk headers
 *   - hunk-body lines prefixed with ` `, `+`, `-`
 *   - `new file mode <oct>` / `deleted file mode <oct>` / `rename from`
 *
 * Binary-file diffs are skipped.
 */

import type { DiffHunk, ParsedDiff } from './types.js';

const FILE_HEADER = /^diff --git a\/(.+?) b\/(.+?)$/;
const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseDiff(diff: string): ParsedDiff {
  const lines = diff.split('\n');
  const hunks: DiffHunk[] = [];
  const fileSet = new Set<string>();

  let currentFile: string | null = null;
  let currentStatus: DiffHunk['status'] = 'modified';
  let currentBody: string[] = [];
  let currentHeader = '';
  let currentOldStart = 0;
  let currentNewStart = 0;
  let inHunk = false;
  let isBinary = false;

  const flush = (): void => {
    if (inHunk && currentFile !== null && !isBinary) {
      hunks.push({
        file: currentFile,
        oldStart: currentOldStart,
        newStart: currentNewStart,
        header: currentHeader,
        body: currentBody.join('\n'),
        status: currentStatus
      });
    }
    inHunk = false;
    currentBody = [];
  };

  for (const line of lines) {
    const fileMatch = FILE_HEADER.exec(line);
    if (fileMatch !== null) {
      flush();
      currentFile = fileMatch[2] ?? fileMatch[1] ?? null;
      if (currentFile !== null) fileSet.add(currentFile);
      currentStatus = 'modified';
      isBinary = false;
      continue;
    }
    if (line.startsWith('new file mode ')) {
      currentStatus = 'added';
      continue;
    }
    if (line.startsWith('deleted file mode ')) {
      currentStatus = 'deleted';
      continue;
    }
    if (line.startsWith('rename from ') || line.startsWith('rename to ')) {
      currentStatus = 'renamed';
      continue;
    }
    if (line.startsWith('Binary files ')) {
      isBinary = true;
      continue;
    }
    if (line.startsWith('--- ') || line.startsWith('+++ ')) {
      // discard — file path already captured
      continue;
    }
    const hunkMatch = HUNK_HEADER.exec(line);
    if (hunkMatch !== null) {
      flush();
      inHunk = true;
      currentHeader = line;
      currentOldStart = Number(hunkMatch[1] ?? '0');
      currentNewStart = Number(hunkMatch[3] ?? '0');
      currentBody = [];
      continue;
    }
    if (inHunk && currentFile !== null && !isBinary) {
      if (line === '' || line.startsWith(' ') || line.startsWith('+') || line.startsWith('-') || line.startsWith('\\')) {
        currentBody.push(line);
      }
    }
  }
  flush();

  return {
    hunks,
    totalBytes: Buffer.byteLength(diff, 'utf-8'),
    fileCount: fileSet.size
  };
}

/** Split a hunk body by max bytes — Datadog BewAIre lesson: large hunks
 * degrade LLM evaluation quality. Sub-hunks share `file`; line offsets are
 * adjusted per chunk. */
export function chunkHunk(hunk: DiffHunk, maxBytes: number): DiffHunk[] {
  if (Buffer.byteLength(hunk.body, 'utf-8') <= maxBytes) return [hunk];

  const lines = hunk.body.split('\n');
  const out: DiffHunk[] = [];
  let bucket: string[] = [];
  let bucketBytes = 0;
  let oldOffset = 0;
  let newOffset = 0;
  let nextOldOffset = 0;
  let nextNewOffset = 0;

  const advance = (line: string): void => {
    if (line.startsWith('-')) nextOldOffset++;
    else if (line.startsWith('+')) nextNewOffset++;
    else if (line.startsWith(' ') || line === '') {
      nextOldOffset++;
      nextNewOffset++;
    }
  };

  const flushBucket = (): void => {
    if (bucket.length === 0) return;
    out.push({
      file: hunk.file,
      oldStart: hunk.oldStart + oldOffset,
      newStart: hunk.newStart + newOffset,
      header: out.length === 0
        ? hunk.header
        : `@@ -${hunk.oldStart + oldOffset} +${hunk.newStart + newOffset} @@ (chunked)`,
      body: bucket.join('\n'),
      status: hunk.status
    });
    oldOffset = nextOldOffset;
    newOffset = nextNewOffset;
    bucket = [];
    bucketBytes = 0;
  };

  for (const line of lines) {
    const lineBytes = Buffer.byteLength(line, 'utf-8') + 1;
    if (bucketBytes + lineBytes > maxBytes && bucket.length > 0) {
      flushBucket();
    }
    bucket.push(line);
    bucketBytes += lineBytes;
    advance(line);
  }
  flushBucket();
  return out;
}

export interface DiffLine {
  /** kind: '+' added, '-' removed, ' ' context. */
  kind: '+' | '-' | ' ';
  newLine: number;
  oldLine: number;
  text: string;
}

/** Walk a hunk body and emit (kind, newLine, oldLine, text) per body line. */
export function walkHunk(hunk: DiffHunk): DiffLine[] {
  const out: DiffLine[] = [];
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  for (const raw of hunk.body.split('\n')) {
    if (raw === '' || raw.startsWith('\\')) continue;
    const prefix = raw[0] ?? ' ';
    const text = raw.slice(1);
    if (prefix === '+') {
      out.push({ kind: '+', newLine, oldLine: -1, text });
      newLine++;
    } else if (prefix === '-') {
      out.push({ kind: '-', newLine: -1, oldLine, text });
      oldLine++;
    } else {
      out.push({ kind: ' ', newLine, oldLine, text });
      newLine++;
      oldLine++;
    }
  }
  return out;
}
