/**
 * Phase-1 scanner registry.
 *
 * The set of scanners run by `caia-curator daily`. Adding a new scanner
 * is a single line append here + the scanner's own module + its tests.
 */

import { dependabotCvesScanner } from './dependabot-cves.js';
import { memoryDriftScanner } from './memory-drift.js';
import { openPrAgeScanner } from './open-pr-age.js';
import { staleTodosScanner } from './stale-todos.js';
import { worktreeCountScanner } from './worktree-count.js';

import type { Scanner } from '../types.js';

export {
  dependabotCvesScanner,
  memoryDriftScanner,
  openPrAgeScanner,
  staleTodosScanner,
  worktreeCountScanner
};

/**
 * The default Phase-1 scanner set. Order is preserved in the digest's
 * "All findings by category" section.
 */
export const phase1Scanners: Scanner[] = [
  worktreeCountScanner,
  openPrAgeScanner,
  memoryDriftScanner,
  staleTodosScanner,
  dependabotCvesScanner
];
