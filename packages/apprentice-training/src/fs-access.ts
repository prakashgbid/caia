/**
 * Default filesystem access — wraps node:fs.
 * Tests inject a fake `FsAccess` that records writes in-memory.
 */

import * as fs from 'node:fs';
import type { FsAccess } from './types.js';

export const defaultFsAccess: FsAccess = {
  exists(p: string): boolean {
    try {
      fs.statSync(p);
      return true;
    } catch {
      return false;
    }
  },
  readFile(p: string): string {
    return fs.readFileSync(p, 'utf-8');
  },
  writeFile(p: string, content: string): void {
    fs.writeFileSync(p, content, 'utf-8');
  },
  mkdir(p: string): void {
    fs.mkdirSync(p, { recursive: true });
  },
  readDir(p: string): string[] {
    return fs.readdirSync(p);
  },
  stat(p: string): { mtimeMs: number; size: number; isFile: boolean; isDirectory: boolean } {
    const s = fs.statSync(p);
    return {
      mtimeMs: s.mtimeMs,
      size: s.size,
      isFile: s.isFile(),
      isDirectory: s.isDirectory()
    };
  }
};
