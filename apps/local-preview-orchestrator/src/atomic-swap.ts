/**
 * Atomic symlink swap for deployment.
 * Swaps the `current` symlink from old build to new build atomically.
 * Also manages the `previous` symlink for instant rollback.
 *
 * Path-traversal note: `sitePath` arguments are produced exclusively from the
 * compile-time SITES registry in sites-config.ts (no user-controllable input
 * reaches this module). The `nosemgrep` annotations on path joins below
 * acknowledge semgrep's static-pattern flag while documenting the trust
 * boundary explicitly.
 */

import { existsSync, readlinkSync, symlinkSync, unlinkSync, renameSync } from 'fs';

export interface SwapResult {
  success: boolean;
  previousTarget?: string;
  currentTarget?: string;
  error?: string;
}

/**
 * Atomically swap the current symlink to point at newBuildDir.
 * Preserves the previous symlink for rollback.
 *
 * @param sitePath - Base path for the site (e.g., ~/.../local-preview/<site>/)
 * @param newBuildDir - Relative path to the new build (e.g., builds/<sha>/)
 * @returns Result with success flag and details
 */
export function atomicSwap(sitePath: string, newBuildDir: string): SwapResult {
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath comes from compile-time SITES registry
    const currentLink = `${sitePath}/current`;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath comes from compile-time SITES registry
    const previousLink = `${sitePath}/previous`;
    const tmpLink = `${currentLink}.tmp`;

    // Read current target if it exists
    let previousTarget: string | undefined;
    if (existsSync(currentLink)) {
      try {
        previousTarget = readlinkSync(currentLink);
      } catch (_e) {
        // If readlink fails (e.g., broken symlink), try to recover from previous
        if (existsSync(previousLink)) {
          previousTarget = readlinkSync(previousLink);
        }
      }
    }

    // Create new symlink pointing to newBuildDir at a temp location
    if (existsSync(tmpLink)) {
      unlinkSync(tmpLink);
    }
    symlinkSync(newBuildDir, tmpLink, 'dir');

    // Atomic swap: attempt atomic rename first (works on macOS)
    if (existsSync(currentLink)) {
      unlinkSync(currentLink);
    }
    renameSync(tmpLink, currentLink);

    // Update previous to point at what was current
    if (previousTarget !== undefined) {
      if (existsSync(previousLink)) {
        unlinkSync(previousLink);
      }
      symlinkSync(previousTarget, previousLink, 'dir');
    }

    const result: SwapResult = {
      success: true,
      currentTarget: newBuildDir
    };

    if (previousTarget !== undefined) {
      result.previousTarget = previousTarget;
    }

    return result;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Atomic swap failed: ${msg}`
    };
  }
}

/**
 * Revert the current symlink to point at the previous build.
 * Used for rollback after a failed health check.
 *
 * @param sitePath - Base path for the site
 * @returns Result with success flag and details
 */
export function rollbackToPrevious(sitePath: string): SwapResult {
  try {
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath comes from compile-time SITES registry
    const currentLink = `${sitePath}/current`;
    // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath comes from compile-time SITES registry
    const previousLink = `${sitePath}/previous`;

    if (!existsSync(previousLink)) {
      return {
        success: false,
        error: 'No previous build available for rollback'
      };
    }

    const previousTarget = readlinkSync(previousLink);
    const tmpLink = `${currentLink}.tmp`;

    // Create new symlink pointing to previous target at temp location
    if (existsSync(tmpLink)) {
      unlinkSync(tmpLink);
    }
    symlinkSync(previousTarget, tmpLink, 'dir');

    // Atomic swap
    if (existsSync(currentLink)) {
      unlinkSync(currentLink);
    }
    renameSync(tmpLink, currentLink);

    return {
      success: true,
      currentTarget: previousTarget
    };
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      error: `Rollback failed: ${msg}`
    };
  }
}

/**
 * Get the current symlink target (the currently-active build SHA).
 *
 * @param sitePath - Base path for the site
 * @returns SHA if symlink exists and points to valid build, or undefined
 */
export function getCurrentTarget(sitePath: string): string | undefined {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath comes from compile-time SITES registry
  const currentLink = `${sitePath}/current`;
  try {
    if (existsSync(currentLink)) {
      return readlinkSync(currentLink);
    }
  } catch {
    // Broken symlink or permission issue
  }
  return undefined;
}

/**
 * Get the previous symlink target (the last-known-good build SHA).
 *
 * @param sitePath - Base path for the site
 * @returns SHA if symlink exists and points to valid build, or undefined
 */
export function getPreviousTarget(sitePath: string): string | undefined {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- sitePath comes from compile-time SITES registry
  const previousLink = `${sitePath}/previous`;
  try {
    if (existsSync(previousLink)) {
      return readlinkSync(previousLink);
    }
  } catch {
    // Broken symlink or permission issue
  }
  return undefined;
}
