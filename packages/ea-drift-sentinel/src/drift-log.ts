/**
 * Drift log — JSONL at caia-ea/drift-log/<YYYY-MM-DD>.jsonl.
 */

import { join } from 'node:path';

import { defaultFsAdapter, type FsAdapter } from '@caia/ea-architect';

import type { DriftLogEntry } from './types.js';

export class DriftLog {
  constructor(
    private readonly dir: string,
    private readonly fs: FsAdapter = defaultFsAdapter
  ) {}

  pathFor(date: Date): string {
    const yyyy = date.getUTCFullYear();
    const mm = String(date.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(date.getUTCDate()).padStart(2, '0');
    return join(this.dir, `${yyyy}-${mm}-${dd}.jsonl`);
  }

  append(entry: DriftLogEntry, date: Date): void {
    const line = JSON.stringify(entry) + '\n';
    this.fs.appendFile(this.pathFor(date), line);
  }
}
