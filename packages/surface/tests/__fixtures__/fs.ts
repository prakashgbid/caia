/**
 * In-memory FsReader for tests. Build a virtual filesystem with `addFile` /
 * `addDir`, then pass to connectors via DI.
 */

import type { FsReader } from '../../src/types.js';

interface FileEntry {
  kind: 'file';
  body: string;
  mtimeIso: string;
}
interface DirEntry {
  kind: 'dir';
}
type Entry = FileEntry | DirEntry;

export class FakeFs implements FsReader {
  private readonly entries = new Map<string, Entry>();

  addFile(path: string, body: string, mtimeIso: string): this {
    this.entries.set(path, { kind: 'file', body, mtimeIso });
    // Auto-create parent dirs.
    let cur = path;
    while (cur.includes('/')) {
      cur = cur.slice(0, cur.lastIndexOf('/'));
      if (cur === '') break;
      if (!this.entries.has(cur)) this.entries.set(cur, { kind: 'dir' });
    }
    return this;
  }

  addDir(path: string): this {
    this.entries.set(path, { kind: 'dir' });
    return this;
  }

  exists(p: string): boolean {
    return this.entries.has(p);
  }
  readFile(p: string): string {
    const e = this.entries.get(p);
    if (e === undefined || e.kind !== 'file') throw new Error(`fake-fs: not a file: ${p}`);
    return e.body;
  }
  readDir(p: string): string[] {
    const e = this.entries.get(p);
    if (e === undefined || e.kind !== 'dir') return [];
    const prefix = p === '/' ? '/' : p + '/';
    const children = new Set<string>();
    for (const path of this.entries.keys()) {
      if (!path.startsWith(prefix)) continue;
      const rest = path.slice(prefix.length);
      if (rest === '') continue;
      const top = rest.includes('/') ? rest.slice(0, rest.indexOf('/')) : rest;
      children.add(top);
    }
    return [...children].sort();
  }
  stat(p: string) {
    const e = this.entries.get(p);
    if (e === undefined) return null;
    if (e.kind === 'dir') {
      return { isDirectory: true, isFile: false, sizeBytes: 0, mtimeIso: '1970-01-01T00:00:00.000Z' };
    }
    return {
      isDirectory: false,
      isFile: true,
      sizeBytes: Buffer.byteLength(e.body, 'utf-8'),
      mtimeIso: e.mtimeIso
    };
  }
}
