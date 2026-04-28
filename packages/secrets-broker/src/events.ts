import { createHash } from 'node:crypto';
import type { AuditEntry } from './types.js';

const AUDIT_MAX = 100;
const auditLog: AuditEntry[] = [];

/** SHA-256 first 16 hex chars of key name — safe to log, never reveals the value */
export function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

export function recordAudit(entry: AuditEntry): void {
  auditLog.push(entry);
  if (auditLog.length > AUDIT_MAX) auditLog.shift();
}

export function getAuditLog(): readonly AuditEntry[] {
  return [...auditLog];
}

export function clearAuditLog(): void {
  auditLog.length = 0;
}

let conductorApi: string | null = process.env['CONDUCTOR_API'] ?? null;

export function configureConductorApi(url: string | null): void {
  conductorApi = url;
}

export function getConductorApi(): string | null {
  return conductorApi;
}

export async function emitEvent(
  type: string,
  payload: Record<string, unknown>,
  severity: 'debug' | 'info' | 'warning' | 'error' = 'info',
): Promise<void> {
  if (!conductorApi) return;
  try {
    await fetch(`${conductorApi}/events`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type,
        actor: 'secrets-broker',
        severity,
        payload,
        occurred_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Best-effort — never fail a secret fetch because event bus is down
  }
}
