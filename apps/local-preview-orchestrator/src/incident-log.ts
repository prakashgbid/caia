/**
 * Incident log for deploy failures and health check issues.
 * Appends structured JSON records to a log file.
 */

import { appendFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';

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
export function logIncident(logPath: string, record: IncidentRecord): void {
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
  } catch (error) {
    // Fail silently; we don't want logging errors to break the deploy
    console.error(`Failed to write incident log: ${error}`);
  }
}

/**
 * Helper to create a deploy-failed incident record.
 */
export function createDeployFailedRecord(
  site: string,
  message: string,
  details?: Record<string, unknown>
): IncidentRecord {
  const result: IncidentRecord = {
    timestamp: new Date().toISOString(),
    site,
    type: 'deploy-failed',
    message
  };

  if (details !== undefined) {
    result.details = details;
  }

  return result;
}

/**
 * Helper to create a health-check-failed incident record.
 */
export function createHealthCheckFailedRecord(
  site: string,
  message: string,
  details?: Record<string, unknown>
): IncidentRecord {
  const result: IncidentRecord = {
    timestamp: new Date().toISOString(),
    site,
    type: 'health-check-failed',
    message
  };

  if (details !== undefined) {
    result.details = details;
  }

  return result;
}

/**
 * Helper to create a rollback incident record.
 */
export function createRollbackRecord(
  site: string,
  message: string,
  details?: Record<string, unknown>
): IncidentRecord {
  const result: IncidentRecord = {
    timestamp: new Date().toISOString(),
    site,
    type: 'rollback',
    message
  };

  if (details !== undefined) {
    result.details = details;
  }

  return result;
}
