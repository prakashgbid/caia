/**
 * Memory-file loader for the re-litigation detector.
 *
 * Walks `<memoryRoot>/feedback_*.md`, parses the markdown frontmatter
 * `name:` field as the topic, and grabs the first ~500 chars of the body
 * as `bodyExcerpt`. Stable + deterministic ordering by filename.
 *
 * If `memoryRoot` doesn't exist → returns an empty array (the detector
 * gracefully degrades to no-op).
 */

import { join } from 'node:path';

import type { FsReader, MemoryFileRef } from './types.js';

const FEEDBACK_FILE = /^feedback_[\w-]+\.md$/;
const FRONTMATTER_NAME = /^name:\s*(.+)$/m;
const BODY_EXCERPT_MAX = 500;

export function loadMemoryFiles(fs: FsReader, memoryRoot: string): MemoryFileRef[] {
  const entries = fs.readDir(memoryRoot);
  const out: MemoryFileRef[] = [];
  for (const name of entries) {
    if (!FEEDBACK_FILE.test(name)) continue;
    const path = join(memoryRoot, name);
    let content: string;
    try {
      content = fs.readFile(path);
    } catch {
      continue;
    }
    const ref = parseMemoryFile(name, content);
    if (ref !== null) out.push(ref);
  }
  return out;
}

export function parseMemoryFile(filename: string, content: string): MemoryFileRef | null {
  const m = FRONTMATTER_NAME.exec(content);
  const topic = m !== null && m[1] !== undefined
    ? m[1].trim().replace(/^["']|["']$/g, '')
    : filename.replace(/^feedback_/, '').replace(/\.md$/, '').replace(/_/g, ' ');
  // Body excerpt — first BODY_EXCERPT_MAX chars after the closing `---`.
  let body = content;
  const fmEnd = content.indexOf('\n---', 4);
  if (content.startsWith('---') && fmEnd > 0) {
    body = content.slice(fmEnd + 4).trimStart();
  }
  const bodyExcerpt = body.slice(0, BODY_EXCERPT_MAX);
  return { filename, topic, bodyExcerpt };
}
