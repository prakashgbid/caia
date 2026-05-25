/**
 * Default `FsAdapter` backed by node:fs. Kept tiny so tests can swap it
 * out with an in-memory map without dragging real I/O into unit tests.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

import type { FsAdapter } from './types.js';

export function makeNodeFsAdapter(): FsAdapter {
  return {
    exists(p) { return fs.existsSync(p); },
    readFile(p) { return fs.readFileSync(p, 'utf8'); },
    writeFile(p, content) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.writeFileSync(p, content, 'utf8');
    },
    appendFile(p, content) {
      fs.mkdirSync(path.dirname(p), { recursive: true });
      fs.appendFileSync(p, content, 'utf8');
    },
    readDir(p) { return fs.readdirSync(p); },
    statMtimeMs(p) { return fs.statSync(p).mtimeMs; },
    isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } },
    mkdirp(p) { fs.mkdirSync(p, { recursive: true }); },
  };
}

/**
 * In-memory adapter for tests. Backed by a simple Map. Tracks mtime
 * with an injectable clock for stable test ordering.
 */
export function makeMemoryFsAdapter(seed: Record<string, string> = {}, clock: () => Date = () => new Date()): FsAdapter & { files: Map<string, { content: string; mtimeMs: number }> } {
  const files = new Map<string, { content: string; mtimeMs: number }>();
  for (const [k, v] of Object.entries(seed)) files.set(k, { content: v, mtimeMs: clock().getTime() });

  function isDir(p: string): boolean {
    if (files.has(p)) return false;
    const prefix = p.endsWith('/') ? p : p + '/';
    for (const k of files.keys()) if (k.startsWith(prefix)) return true;
    return false;
  }

  return {
    files,
    exists(p) { return files.has(p) || isDir(p); },
    readFile(p) {
      const e = files.get(p);
      if (!e) throw new Error(`ENOENT: ${p}`);
      return e.content;
    },
    writeFile(p, content) { files.set(p, { content, mtimeMs: clock().getTime() }); },
    appendFile(p, content) {
      const existing = files.get(p);
      const next = (existing?.content ?? '') + content;
      files.set(p, { content: next, mtimeMs: clock().getTime() });
    },
    readDir(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set<string>();
      for (const k of files.keys()) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          const segment = rest.split('/')[0];
          if (segment !== undefined && segment.length > 0) out.add(segment);
        }
      }
      return [...out].sort();
    },
    statMtimeMs(p) {
      const e = files.get(p);
      if (!e) throw new Error(`ENOENT: ${p}`);
      return e.mtimeMs;
    },
    isDir,
    mkdirp(_p) { /* no-op for memory adapter */ },
  };
}
