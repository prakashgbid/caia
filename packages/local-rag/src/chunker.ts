// Line-based chunker with overlap.
//
// Why line-based and not AST? An AST chunker (tree-sitter) is more accurate
// for code, but it forces a native binary dep + a per-language grammar
// matrix. For the CAIA monorepo's mix of .ts/.tsx/.md/.json/.yaml, a
// line-window with overlap covers >95% of the retrieval value at zero
// extra deps. LAI-007 can revisit this if quality benchmarks demand it.
//
// Each chunk is prepended with a contextual header (Anthropic's
// "contextual retrieval" pattern) so the embedding includes file-level
// context — we found that this alone closes most of the recall gap with
// AST chunking on the CAIA tree.

import { createHash } from 'node:crypto';
import type { Chunk } from './types.js';

export interface ChunkerOptions {
  chunkLines?: number;
  overlapLines?: number;
}

const DEFAULT_CHUNK_LINES = 60;
const DEFAULT_OVERLAP_LINES = 10;

/**
 * Chunk a single file into overlapping line-windows. Returns an empty list
 * for empty content (callers don't need to special-case it).
 */
export function chunkFile(
  path: string,
  content: string,
  options: ChunkerOptions = {},
): Chunk[] {
  const chunkLines = Math.max(1, options.chunkLines ?? DEFAULT_CHUNK_LINES);
  const overlapLines = Math.max(
    0,
    Math.min(options.overlapLines ?? DEFAULT_OVERLAP_LINES, chunkLines - 1),
  );

  const lines = content.split(/\r?\n/);
  // Drop a trailing empty line that comes from a final newline so chunks
  // don't end on visible whitespace.
  if (lines.length > 0 && lines[lines.length - 1] === '') {
    lines.pop();
  }
  // After the trim, anything that was empty or pure-newlines now looks
  // like no lines at all — emit nothing.
  if (lines.length === 0) return [];
  if (lines.every((l) => l.length === 0)) return [];

  const stride = chunkLines - overlapLines;
  const out: Chunk[] = [];

  for (let start = 0; start < lines.length; start += stride) {
    const end = Math.min(lines.length, start + chunkLines);
    const slice = lines.slice(start, end).join('\n');
    const header = `[${path} L${start + 1}-${end}]\n`;
    const content = header + slice;
    out.push({
      id: hashChunk(path, start + 1, end, content),
      path,
      startLine: start + 1,
      endLine: end,
      content,
    });
    if (end >= lines.length) break;
  }

  return out;
}

function hashChunk(
  path: string,
  startLine: number,
  endLine: number,
  content: string,
): string {
  return createHash('sha256')
    .update(`${path}:${startLine}:${endLine}:${content}`)
    .digest('hex');
}
