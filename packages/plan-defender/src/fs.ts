/**
 * Minimal filesystem adapter. Mirrors the same shape used by
 * @caia/ea-architect/src/fs-adapter so callers can pass a single adapter
 * to both packages.
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync
} from 'node:fs';
import { dirname } from 'node:path';

export interface FsLike {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  appendFile(path: string, content: string): void;
  readDir(path: string): string[];
  mkdir(path: string): void;
}

export const defaultFs: FsLike = {
  exists(path: string): boolean {
    return existsSync(path);
  },
  readFile(path: string): string {
    return readFileSync(path, 'utf8');
  },
  writeFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  },
  appendFile(path: string, content: string): void {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, content, 'utf8');
  },
  readDir(path: string): string[] {
    if (!existsSync(path)) return [];
    return readdirSync(path);
  },
  mkdir(path: string): void {
    mkdirSync(path, { recursive: true });
  }
};

/** Memory FS for tests. */
export class MemoryFs implements FsLike {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [p, c] of Object.entries(seed)) this.writeFile(p, c);
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }
  readFile(path: string): string {
    const v = this.files.get(path);
    if (v === undefined) throw new Error(`MemoryFs: file not found: ${path}`);
    return v;
  }
  writeFile(path: string, content: string): void {
    this.files.set(path, content);
    let parent = path;
    while (parent.includes('/')) {
      const i = parent.lastIndexOf('/');
      parent = parent.slice(0, i);
      if (parent === '') break;
      this.dirs.add(parent);
    }
  }
  appendFile(path: string, content: string): void {
    const existing = this.files.get(path) ?? '';
    this.writeFile(path, existing + content);
  }
  readDir(path: string): string[] {
    const out = new Set<string>();
    const prefix = path.endsWith('/') ? path : path + '/';
    for (const file of this.files.keys()) {
      if (file.startsWith(prefix)) {
        const seg = file.slice(prefix.length).split('/')[0];
        if (seg !== undefined && seg !== '') out.add(seg);
      }
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) {
        const seg = dir.slice(prefix.length).split('/')[0];
        if (seg !== undefined && seg !== '') out.add(seg);
      }
    }
    return [...out].sort();
  }
  mkdir(path: string): void {
    this.dirs.add(path);
  }

  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }
}
