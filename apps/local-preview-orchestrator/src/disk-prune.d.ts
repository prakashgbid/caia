/**
 * Disk pruning for local preview builds.
 * Keeps the last N successful builds per site; removes older ones.
 * Never prunes the targets of `current` or `previous` symlinks.
 */
export interface PruneResult {
    success: boolean;
    removedDirs?: string[];
    keptDirs?: string[];
    error?: string;
}
/**
 * Prune old build directories, keeping only the most recent N.
 * Respects `current` and `previous` symlinks — never deletes their targets.
 *
 * @param sitePath - Base path for the site (e.g., ~/.../local-preview/<site>/)
 * @param keepCount - Number of builds to keep (default 10)
 * @returns Result with success flag and details
 */
export declare function pruneBuilds(sitePath: string, keepCount?: number): PruneResult;
/**
 * Get the total disk usage of all builds for a site.
 *
 * @param sitePath - Base path for the site
 * @returns Total size in bytes, or undefined on error
 */
export declare function getBuildsSize(sitePath: string): number | undefined;
/**
 * Check if disk usage for a site is below a threshold.
 *
 * @param sitePath - Base path for the site
 * @param maxBytes - Max allowed bytes (default 5GB)
 * @returns True if usage is below threshold
 */
export declare function isDiskUsageOk(sitePath: string, maxBytes?: number): boolean;
//# sourceMappingURL=disk-prune.d.ts.map