import { appendFileSync } from 'node:fs';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { isoNow } from './time.js';
import { assertValidAudit } from './audit-schema.js';
import type { AuditEvent } from './types.js';

// H-19 (chain-runner-battle-harden phase 10, 2026-05-14). assertValidAudit
// is a no-op in production. When CAIA_VALIDATE_AUDIT=1 it throws on
// schema mismatch — call sites get a loud failure during dev/tests and the
// production hot-path stays a single env-var read.
export function appendAudit(
  auditFile: string,
  event: string,
  details: Record<string, unknown> = {},
): void {
  mkdirSync(dirname(auditFile), { recursive: true });
  assertValidAudit(event, details);
  const entry: AuditEvent = { ts: isoNow(), event, ...details };
  appendFileSync(auditFile, `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}
