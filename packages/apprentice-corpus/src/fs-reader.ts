/**
 * Default real-filesystem reader.
 *
 * Tests inject a fake by passing `fs` in `ApprenticeCorpusConfig`.
 * Production passes nothing and gets this implementation.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';

import type { FsReader } from './types.js';

export const defaultFsReader: FsReader = {
  exists(p) {
    return existsSync(p);
  },
  readDir(p) {
    return readdirSync(p);
  },
  readFile(p) {
    return readFileSync(p, 'utf-8');
  },
  stat(p) {
    const s = statSync(p);
    return { mtimeMs: s.mtimeMs, size: s.size, isFile: s.isFile() };
  }
};
