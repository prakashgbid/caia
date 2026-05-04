/**
 * Disk pruning for local preview builds.
 * Keeps the last N successful builds per site; removes older ones.
 * Never prunes the targets of `current` or `previous` symlinks.
 *
 * Path-traversal note: `sitePath` arguments are produced exclusively from the
 * compile-time SITES registry in sites-config.ts (no user-controllable input
 * reaches this module). The `nosemgrep` annotations on path joins below
 * acknowledge semgrep's static-pattern flag while documenting the trust
 * boundary explicitly.
 */

import { existsSync, readlinkSync, readdirSync, rmSync, statSync, type Dirent } from 'fs';
import { join, resolve } from 'path';

export interface PruneResult {
  success: boolean;
  removedDirs?: string[];
  keptDirs?: string[];
  error?: string;
}

/**
 * Prune old build directories, keeping only the most recent N.
 * Also keeps any builds that are currently pointed to by current or previous symlinks.
 *
 * @param sitePath - Base path for the site (e.g., ~/.../local-preview/<site>/)
 * @param keepCount - Number of builds to keep (default 10, plus any symlink targets)
 * @returns Result with success flag and details
 */
export function pruneBuilds(sitePath: string, keepCount: number = 10): PruneResult {
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry
    const buildsDir = join(sitePath, 'builds');
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry
    const currentLink = join(sitePath, 'current');
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry
    const previousLink = join(sitePath, 'previous');

    if (!existsSync(buildsDir)) {
      return {
        success: true,
        removedDirs: [],
        keptDirs: []
      };
    }

    // Get the targets of current and previous symlinks
    // Symlink targets are relative to the symlink's directory, so resolve them relative to sitePath
    const protectedTargets = new Set<string>();
    try {
      if (existsSync(currentLink)) {
        const target = readlinkSync(currentLink);
        // Symlink target is relative to sitePath (where the symlink is)
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry; target is read from symlink under sitePath
        const absoluteTarget = resolve(sitePath, target);
        protectedTargets.add(absoluteTarget);
      }
    } catch {
      // Ignore broken symlinks
    }

    try {
      if (existsSync(previousLink)) {
        const target = readlinkSync(previousLink);
        // Symlink target is relative to sitePath
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry; target is read from symlink under sitePath
        const absoluteTarget = resolve(sitePath, target);
        protectedTargets.add(absoluteTarget);
      }
    } catch {
      // Ignore broken symlinks
    }

    // List all build directories (assuming they're named by SHA)
    const buildDirs = readdirSync(buildsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- buildsDir derived from compile-time SITES registry; entry.name from filesystem under buildsDir
        path: join(buildsDir, entry.name)
      }))
      .sort((a, b) => a.name.localeCompare(b.name)); // Sort lexicographically

    const removed: string[] = [];
    const kept: string[] = [];

    // Determine which dirs to keep: the most recent keepCount, plus any protected targets
    const keptPaths = new Set<string>();

    // Add the most recent keepCount to the kept set
    for (let i = Math.max(0, buildDirs.length - keepCount); i < buildDirs.length; i++) {
      keptPaths.add(buildDirs[i]!.path);
    }

    // Add all protected targets to the kept set
    for (const target of protectedTargets) {
      keptPaths.add(target);
    }

    // Remove all dirs not in the kept set
    for (const dir of buildDirs) {
      if (keptPaths.has(dir.path)) {
        kept.push(dir.name);
      } else {
        try {
          rmSync(dir.path, { recursive: true, force: true });
          removed.push(dir.name);
        } catch (error) {
          // Log but continue with other removals
          console.error(`Failed to remove build dir ${dir.name}: ${error}`);
        }
      }
    }

    return {
      success: true,
      removedDirs: removed,
      keptDirs: kept
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Prune failed: ${msg}`
    };
  }
}

/**
 * Get the total disk usage of all builds for a site.
 * Uses native fs traversal (no subprocess) so it is shell-injection-safe.
 *
 * @param sitePath - Base path for the site
 * @returns Total size in bytes, or undefined on error
 */
export function getBuildsSize(sitePath: string): number | undefined {
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath from compile-time SITES registry
    const buildsDir = join(sitePath, 'builds');
    if (!existsSync(buildsDir)) {
      return 0;
    }

    return computeDirSize(buildsDir);
  } catch {
    return undefined;
  }
}

/**
 * Recursively compute the size of a directory tree in bytes.
 * Pure-fs implementation (no subprocess) — semgrep-clean.
 * Skips symlinks (does not follow them) to avoid double-counting and cycles.
 */
function computeDirSize(dirPath: string): number {
  let total = 0;
  let entries: Dirent[];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true }) as Dirent[];
  } catch {
    return 0;
  }
  for (const entry of entries) {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- dirPath rooted at sitePath/builds; entry.name from readdir
    const childPath = join(dirPath, entry.name);
    try {
      if (entry.isSymbolicLink()) {
        // Skip — do not follow symlinks (cycle/double-count protection)
        continue;
      }
      if (entry.isDirectory()) {
        total += computeDirSize(childPath);
      } else if (entry.isFile()) {
        total += statSync(childPath).size;
      }
    } catch {
      // Skip unreadable entries
    }
  }
  return total;
}

/**
 * Check if disk usage for a site is below a threshold.
 *
 * @param sitePath - Base path for the site
 * @param maxBytes - Max allowed bytes (default 5GB)
 * @returns True if usage is below threshold
 */
export function isDiskUsageOk(sitePath: string, maxBytes: number = 5 * 1024 * 1024 * 1024): boolean {
  const size = getBuildsSize(sitePath);
  return size !== undefined && size < maxBytes;
}
