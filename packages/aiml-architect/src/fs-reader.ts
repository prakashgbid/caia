/**
 * Default filesystem reader. Tests inject a fake instead.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync
} from 'node:fs';

import type { FsReader } from './types.js';

export const defaultFsReader: FsReader = {
  exists(path: string): boolean {
    return existsSync(path);
  },
  readDir(path: string): string[] {
    return readdirSync(path);
  },
  readFile(path: string): string {
    return readFileSync(path, 'utf-8');
  },
  stat(path: string): { mtimeMs: number; size: number; isFile: boolean } {
    const s = statSync(path);
    return {
      mtimeMs: s.mtimeMs,
      size: s.size,
      isFile: s.isFile()
    };
  }
};
