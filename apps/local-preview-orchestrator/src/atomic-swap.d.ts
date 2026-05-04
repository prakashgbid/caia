/**
 * Atomic symlink swap for deployment.
 * Swaps the `current` symlink from old build to new build atomically.
 * Also manages the `previous` symlink for instant rollback.
 */
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
export declare function atomicSwap(sitePath: string, newBuildDir: string): SwapResult;
/**
 * Revert the current symlink to point at the previous build.
 * Used for rollback after a failed health check.
 *
 * @param sitePath - Base path for the site
 * @returns Result with success flag and details
 */
export declare function rollbackToPrevious(sitePath: string): SwapResult;
/**
 * Get the current symlink target (the currently-active build SHA).
 *
 * @param sitePath - Base path for the site
 * @returns SHA if symlink exists and points to valid build, or undefined
 */
export declare function getCurrentTarget(sitePath: string): string | undefined;
/**
 * Get the previous symlink target (the last-known-good build SHA).
 *
 * @param sitePath - Base path for the site
 * @returns SHA if symlink exists and points to valid build, or undefined
 */
export declare function getPreviousTarget(sitePath: string): string | undefined;
//# sourceMappingURL=atomic-swap.d.ts.map