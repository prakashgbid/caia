/**
 * Incident log for deploy failures and health check issues.
 * Appends structured JSON records to a log file.
 */
export interface IncidentRecord {
    timestamp: string;
    site: string;
    type: 'deploy-failed' | 'health-check-failed' | 'rollback' | 'other';
    message: string;
    details?: Record<string, unknown>;
}
/**
 * Log an incident to the incident log file.
 * Creates the directory if it doesn't exist.
 *
 * @param logPath - Full path to the incident log file
 * @param record - Incident record to log
 */
export declare function logIncident(logPath: string, record: IncidentRecord): void;
/**
 * Helper to create a deploy-failed incident record.
 */
export declare function createDeployFailedRecord(site: string, message: string, details?: Record<string, unknown>): IncidentRecord;
/**
 * Helper to create a health-check-failed incident record.
 */
export declare function createHealthCheckFailedRecord(site: string, message: string, details?: Record<string, unknown>): IncidentRecord;
/**
 * Helper to create a rollback incident record.
 */
export declare function createRollbackRecord(site: string, message: string, details?: Record<string, unknown>): IncidentRecord;
//# sourceMappingURL=incident-log.d.ts.map