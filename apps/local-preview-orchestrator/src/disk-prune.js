/**
 * Disk pruning for local preview builds.
 * Keeps the last N successful builds per site; removes older ones.
 * Never prunes the targets of `current` or `previous` symlinks.
 */
import { existsSync, readlinkSync, readdirSync, rmSync } from 'fs';
import { join } from 'path';
/**
 * Prune old build directories, keeping only the most recent N.
 * Respects `current` and `previous` symlinks — never deletes their targets.
 *
 * @param sitePath - Base path for the site (e.g., ~/.../local-preview/<site>/)
 * @param keepCount - Number of builds to keep (default 10)
 * @returns Result with success flag and details
 */
export function pruneBuilds(sitePath, keepCount = 10) {
    try {
        const buildsDir = join(sitePath, 'builds');
        const currentLink = join(sitePath, 'current');
        const previousLink = join(sitePath, 'previous');
        if (!existsSync(buildsDir)) {
            return {
                success: true,
                removedDirs: [],
                keptDirs: []
            };
        }
        // Get the targets of current and previous symlinks
        const protectedTargets = new Set();
        try {
            if (existsSync(currentLink)) {
                const target = readlinkSync(currentLink);
                // Normalize to absolute path if relative
                protectedTargets.add(join(buildsDir, target));
            }
        }
        catch {
            // Ignore broken symlinks
        }
        try {
            if (existsSync(previousLink)) {
                const target = readlinkSync(previousLink);
                protectedTargets.add(join(buildsDir, target));
            }
        }
        catch {
            // Ignore broken symlinks
        }
        // List all build directories (assuming they're named by SHA)
        const buildDirs = readdirSync(buildsDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => ({
            name: entry.name,
            path: join(buildsDir, entry.name)
        }))
            .sort((a, b) => a.name.localeCompare(b.name)); // Sort lexicographically
        const removed = [];
        const kept = [];
        // Remove all but the last keepCount
        if (buildDirs.length > keepCount) {
            const toRemove = buildDirs.slice(0, buildDirs.length - keepCount);
            for (const dir of toRemove) {
                // Never remove a protected target
                if (protectedTargets.has(dir.path)) {
                    kept.push(dir.name);
                    continue;
                }
                try {
                    rmSync(dir.path, { recursive: true, force: true });
                    removed.push(dir.name);
                }
                catch (error) {
                    // Log but continue with other removals
                    console.error(`Failed to remove build dir ${dir.name}: ${error}`);
                }
            }
        }
        // All remaining builds
        for (const dir of buildDirs) {
            if (!removed.includes(dir.name)) {
                kept.push(dir.name);
            }
        }
        return {
            success: true,
            removedDirs: removed,
            keptDirs: kept.slice(-keepCount) // Show the last N kept
        };
    }
    catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        return {
            success: false,
            error: `Prune failed: ${msg}`
        };
    }
}
/**
 * Get the total disk usage of all builds for a site.
 *
 * @param sitePath - Base path for the site
 * @returns Total size in bytes, or undefined on error
 */
export function getBuildsSize(sitePath) {
    try {
        const buildsDir = join(sitePath, 'builds');
        if (!existsSync(buildsDir)) {
            return 0;
        }
        // Use du -sb for accurate size
        const { execSync } = require('child_process');
        const output = execSync(`du -sb "${buildsDir}"`, { encoding: 'utf-8' }).trim();
        const size = parseInt(output.split('\t')[0], 10);
        return isNaN(size) ? undefined : size;
    }
    catch {
        return undefined;
    }
}
/**
 * Check if disk usage for a site is below a threshold.
 *
 * @param sitePath - Base path for the site
 * @param maxBytes - Max allowed bytes (default 5GB)
 * @returns True if usage is below threshold
 */
export function isDiskUsageOk(sitePath, maxBytes = 5 * 1024 * 1024 * 1024) {
    const size = getBuildsSize(sitePath);
    return size !== undefined && size < maxBytes;
}
//# sourceMappingURL=disk-prune.js.map