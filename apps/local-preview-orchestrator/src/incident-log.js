/**
 * Incident log for deploy failures and health check issues.
 * Appends structured JSON records to a log file.
 */
import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
/**
 * Log an incident to the incident log file.
 * Creates the directory if it doesn't exist.
 *
 * @param logPath - Full path to the incident log file
 * @param record - Incident record to log
 */
export function logIncident(logPath, record) {
    try {
        const dir = dirname(logPath);
        if (!existsSync(dir)) {
            mkdirSync(dir, { recursive: true });
        }
        const entry = JSON.stringify({
            ...record,
            timestamp: record.timestamp || new Date().toISOString()
        });
        appendFileSync(logPath, entry + '\n', { encoding: 'utf-8' });
    }
    catch (error) {
        // Fail silently; we don't want logging errors to break the deploy
        console.error(`Failed to write incident log: ${error}`);
    }
}
/**
 * Helper to create a deploy-failed incident record.
 */
export function createDeployFailedRecord(site, message, details) {
    return {
        timestamp: new Date().toISOString(),
        site,
        type: 'deploy-failed',
        message,
        details
    };
}
/**
 * Helper to create a health-check-failed incident record.
 */
export function createHealthCheckFailedRecord(site, message, details) {
    return {
        timestamp: new Date().toISOString(),
        site,
        type: 'health-check-failed',
        message,
        details
    };
}
/**
 * Helper to create a rollback incident record.
 */
export function createRollbackRecord(site, message, details) {
    return {
        timestamp: new Date().toISOString(),
        site,
        type: 'rollback',
        message,
        details
    };
}
//# sourceMappingURL=incident-log.js.map