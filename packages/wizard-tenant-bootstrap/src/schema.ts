/**
 * Schema-name validation. The orchestrator REFUSES to apply migrations to
 * anything that doesn't match `^tenant_[a-z0-9_]+$` — the convention set
 * by `apps/dashboard/lib/tenants/store.ts::schemaNameForEmail()`.
 *
 * The validation is defence-in-depth: provisioning already sanitises the
 * name. Re-validating here means a future caller that bypasses provisioning
 * still can't SQL-inject through a malicious schema string.
 */
export const TENANT_SCHEMA_RE = /^tenant_[a-z0-9_]+$/;

export function assertValidTenantSchema(name: string): void {
  if (!TENANT_SCHEMA_RE.test(name)) {
    throw new Error(
      `wizard-tenant-bootstrap: invalid tenant schema name "${name}" — must match ${TENANT_SCHEMA_RE.source}`,
    );
  }
  if (name.length > 63) {
    // Postgres NAMEDATALEN cap.
    throw new Error(
      `wizard-tenant-bootstrap: schema name "${name}" exceeds 63-char Postgres identifier limit`,
    );
  }
}

/**
 * Quote a validated tenant schema name for safe interpolation. Validation
 * has already restricted the alphabet, so quoting is a belt-and-braces
 * defence rather than a real injection barrier.
 */
export function quoteSchema(name: string): string {
  assertValidTenantSchema(name);
  return `"${name}"`;
}
