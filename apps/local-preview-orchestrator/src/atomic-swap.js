/**
 * Atomic symlink swap for deployment.
 * Swaps the `current` symlink from old build to new build atomically.
 * Also manages the `previous` symlink for instant rollback.
 */
import { execSync } from 'child_process';
import { existsSync, readlinkSync, symlinkSync, unlinkSync } from 'fs';
/**
 * Atomically swap the current symlink to point at newBuildDir.
 * Preserves the previous symlink for rollback.
 *
 * @param sitePath - Base path for the site (e.g., ~/.../local-preview/<site>/)
 * @param newBuildDir - Relative path to the new build (e.g., builds/<sha>/)
 * @returns Result with success flag and details
 */
export function atomicSwap(sitePath, newBuildDir) {
    try {
        const currentLink = `${sitePath}/current`;
        const previousLink = `${sitePath}/previous`;
        const tmpLink = `${currentLink}.tmp`;
        // Read current target if it exists
        let previousTarget;
        if (existsSync(currentLink)) {
            try {
                previousTarget = readlinkSync(currentLink);
            }
            catch (e) {
                // If readlink fails (e.g., broken symlink), try to recover from previous
                if (existsSync(previousLink)) {
                    previousTarget = readlinkSync(previousLink);
                }
            }
        }
        // Create new symlink pointing to newBuildDir at a temp location
        // We create the symlink at currentLink.tmp first, then atomically swap
        if (existsSync(tmpLink)) {
            unlinkSync(tmpLink);
        }
        symlinkSync(newBuildDir, tmpLink, 'dir');
        // Atomic swap: mv -fT current.tmp current
        // This replaces the current symlink atomically
        execSync(`mv -fT "${tmpLink}" "${currentLink}"`);
        // Update previous to point at what was current
        if (previousTarget) {
            if (existsSync(previousLink)) {
                unlinkSync(previousLink);
            }
            symlinkSync(previousTarget, previousLink, 'dir');
        }
        return {
            success: true,
            previousTarget,
            currentTarget: newBuildDir
        };
    }
    catch (error) {
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
export function rollbackToPrevious(sitePath) {
    try {
        const currentLink = `${sitePath}/current`;
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
        execSync(`mv -fT "${tmpLink}" "${currentLink}"`);
        return {
            success: true,
            currentTarget: previousTarget
        };
    }
    catch (error) {
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
export function getCurrentTarget(sitePath) {
    const currentLink = `${sitePath}/current`;
    try {
        if (existsSync(currentLink)) {
            return readlinkSync(currentLink);
        }
    }
    catch {
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
export function getPreviousTarget(sitePath) {
    const previousLink = `${sitePath}/previous`;
    try {
        if (existsSync(previousLink)) {
            return readlinkSync(previousLink);
        }
    }
    catch {
        // Broken symlink or permission issue
    }
    return undefined;
}
//# sourceMappingURL=atomic-swap.js.map