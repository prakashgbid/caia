/**
 * Default filesystem adapter — wraps node:fs. Every disk operation in
 * `@caia/ea-architect` flows through this seam so tests can substitute
 * an in-memory mock.
 */

import { existsSync, readFileSync, writeFileSync, appendFileSync, readdirSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import type { FsAdapter } from './types.js';

export const defaultFsAdapter: FsAdapter = {
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

/** In-memory FS adapter — for tests. Maps absolute path → content. */
export class InMemoryFsAdapter implements FsAdapter {
  private readonly files = new Map<string, string>();
  private readonly dirs = new Set<string>();

  constructor(seed: Record<string, string> = {}) {
    for (const [path, content] of Object.entries(seed)) {
      this.writeFile(path, content);
    }
  }

  exists(path: string): boolean {
    return this.files.has(path) || this.dirs.has(path);
  }

  readFile(path: string): string {
    const content = this.files.get(path);
    if (content === undefined) {
      throw new Error(`InMemoryFsAdapter: file not found: ${path}`);
    }
    return content;
  }

  writeFile(path: string, content: string): void {
    this.files.set(path, content);
    // Track parent dirs so readDir works.
    let parent = path;
    while (parent.includes('/')) {
      const idx = parent.lastIndexOf('/');
      parent = parent.slice(0, idx);
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
        const rest = file.slice(prefix.length);
        const segment = rest.split('/')[0];
        if (segment !== undefined && segment !== '') {
          out.add(segment);
        }
      }
    }
    for (const dir of this.dirs) {
      if (dir.startsWith(prefix)) {
        const rest = dir.slice(prefix.length);
        const segment = rest.split('/')[0];
        if (segment !== undefined && segment !== '') {
          out.add(segment);
        }
      }
    }
    return [...out].sort();
  }

  mkdir(path: string): void {
    this.dirs.add(path);
  }

  /** Snapshot all written files — used by tests. */
  snapshot(): Record<string, string> {
    return Object.fromEntries(this.files.entries());
  }

  /** Direct accessor for tests. */
  has(path: string): boolean {
    return this.files.has(path);
  }

  /** Direct accessor for tests. */
  get(path: string): string | undefined {
    return this.files.get(path);
  }
}
