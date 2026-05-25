/**
 * FsAdapter implementations. NodeFsAdapter for production; MemoryFsAdapter
 * for tests.
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
    mkdirp(p) { fs.mkdirSync(p, { recursive: true }); },
  };
}

export function makeMemoryFsAdapter(seed: Record<string, string> = {}): FsAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>(Object.entries(seed));
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
      const c = files.get(p);
      if (c === undefined) throw new Error('ENOENT: ' + p);
      return c;
    },
    writeFile(p, content) { files.set(p, content); },
    appendFile(p, content) { files.set(p, (files.get(p) ?? '') + content); },
    readDir(p) {
      const prefix = p.endsWith('/') ? p : p + '/';
      const out = new Set<string>();
      for (const k of files.keys()) {
        if (k.startsWith(prefix)) {
          const rest = k.slice(prefix.length);
          const seg = rest.split('/')[0];
          if (seg !== undefined && seg.length > 0) out.add(seg);
        }
      }
      return [...out].sort();
    },
    mkdirp(_p) { /* no-op */ },
  };
}
