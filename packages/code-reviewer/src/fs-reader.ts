/**
 * Default real-filesystem reader. Tests inject a fake instead.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';

import type { FsReader } from './types.js';

export const defaultFsReader: FsReader = {
  exists(p: string): boolean {
    return existsSync(p);
  },
  readFile(p: string): string {
    return readFileSync(p, 'utf-8');
  },
  readDir(p: string): string[] {
    if (!existsSync(p)) return [];
    try {
      const st = statSync(p);
      if (!st.isDirectory()) return [];
      return readdirSync(p).sort();
    } catch {
      return [];
    }
  }
};
