import { dirname, isAbsolute, resolve } from 'node:path';

import { parseExports } from './parse-exports.js';
import { diffExports, readSnapshot, writeSnapshotAtomic } from './snapshot.js';
import type { DetectNewExportsOptions, DetectNewExportsResult, ExportsSnapshot } from './types.js';

/**
 * Detect newly added top-level exports in a workspace package's entry file.
 *
 * Resolves the snapshot at `<pkgRoot>/.adoption/exports-snapshot.json` where
 * `<pkgRoot>` is the directory two levels above the index file
 * (`packages/<pkg>/src/index.ts` ⇒ `packages/<pkg>/.adoption/...`).
 *
 * On first run (snapshot missing), every parsed export is considered new and
 * a fresh snapshot is persisted. Subsequent runs return only the rows that
 * appeared since the last snapshot, then atomically rewrite the snapshot.
 */
export function detectNewExports(
  indexPath: string,
  options: DetectNewExportsOptions = {},
): DetectNewExportsResult {
  if (!isAbsolute(indexPath)) {
    throw new Error(`detectNewExports: indexPath must be absolute, got ${indexPath}`);
  }

  const snapshotPath = options.snapshotPath ?? defaultSnapshotPath(indexPath);
  const exports = parseExports(indexPath);
  const prior = readSnapshot(snapshotPath);
  const firstRun = prior === null;
  const newExports = firstRun ? exports.slice() : diffExports(prior.exports, exports);

  const writeSnapshot = options.writeSnapshot ?? true;
  if (writeSnapshot) {
    const snapshot: ExportsSnapshot = {
      version: 1,
      indexPath,
      capturedAt: new Date().toISOString(),
      exports,
    };
    writeSnapshotAtomic(snapshotPath, snapshot);
  }

  return {
    exports,
    newExports,
    snapshotPath,
    firstRun,
  };
}

export function defaultSnapshotPath(indexPath: string): string {
  // packages/<pkg>/src/index.ts → packages/<pkg>/.adoption/exports-snapshot.json
  const pkgRoot = resolve(dirname(indexPath), '..');
  return resolve(pkgRoot, '.adoption', 'exports-snapshot.json');
}
