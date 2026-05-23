/**
 * Tenant→Infisical-project resolver.
 *
 * Pattern B from the architecture spec: one Infisical project per tenant.
 * The mapping is canonical and must be persisted somewhere; this module
 * only provides the *interface*. Implementations may be backed by:
 *
 *   - a static config map (development + tests)
 *   - a Postgres lookup against `caia_meta.tenant_secret_routing`
 *   - the Infisical API itself (`GET /api/v1/workspace` searched by name)
 *
 * Tenant ids that map to projects are validated up-front; missing
 * mappings throw `SecretPolicyDeniedError` rather than `SecretNotFoundError`
 * because the policy layer (router) is what decides which tenants get
 * which adapters.
 */

import { SecretPolicyDeniedError } from '@caia/secrets-adapter';

export interface ProjectResolver {
  resolve(tenantId: string): Promise<string>;
}

/** Static map. Useful for tests and small fleets. */
export class ConfigMapProjectResolver implements ProjectResolver {
  private readonly map: ReadonlyMap<string, string>;
  constructor(entries: Readonly<Record<string, string>> | ReadonlyMap<string, string>) {
    this.map =
      entries instanceof Map
        ? new Map(entries)
        : new Map(Object.entries(entries));
  }
  async resolve(tenantId: string): Promise<string> {
    const projectId = this.map.get(tenantId);
    if (!projectId) {
      throw new SecretPolicyDeniedError(
        `no Infisical project configured for tenant '${tenantId}'`,
        { tenantId },
      );
    }
    return projectId;
  }
}

/** Function-backed resolver — for arbitrary lookup sources. */
export class FunctionProjectResolver implements ProjectResolver {
  constructor(private readonly fn: (tenantId: string) => Promise<string | undefined>) {}
  async resolve(tenantId: string): Promise<string> {
    const projectId = await this.fn(tenantId);
    if (!projectId) {
      throw new SecretPolicyDeniedError(
        `no Infisical project configured for tenant '${tenantId}'`,
        { tenantId },
      );
    }
    return projectId;
  }
}
