import { appendFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isoNow } from './time.js';
import type { AuditEvent } from './types.js';

export function appendAudit(
  auditFile: string,
  event: string,
  details: Record<string, unknown> = {},
): void {
  mkdirSync(dirname(auditFile), { recursive: true });
  const entry: AuditEvent = { ts: isoNow(), event, ...details };
  appendFileSync(auditFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}
