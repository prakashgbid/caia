// REUSE-FIRST EXCEPTION: short-lived duplicate, refactor to shared package tracked at follow-up B-task
// TODO(ADR): short-lived duplication of apps/wizard/lib/auth + lib/tenants until the shared `@chiefaia/wizard-auth` package lands (B-task tracked in PLAN.md §7).
/**
 * Thin Infisical project-creation client.
 *
 * Why a hand-rolled client and not `@caia/secrets-infisical`:
 * that package wraps the secrets *data* API (CRUD on individual secrets
 * inside an existing workspace) — see its `InfisicalClient`. Project /
 * workspace *creation* is admin API territory and isn't part of its
 * surface. When that capability lands in `@caia/secrets-infisical` we
 * swap the import here in one place.
 *
 * Reuse-first compliance:
 *   - No raw axios / node-fetch — uses native `fetch` (allowed).
 *   - No raw shadcn / radix.
 *   - Reuse-search-results in PLAN.md documents this decision.
 *
 * Endpoint shape (self-hosted Infisical V3 admin API):
 *   POST {baseUrl}/api/v2/workspace
 *   body: { workspaceName, organizationId, type: "production" }
 *   auth: Bearer <admin token>
 *   200 → { workspace: { _id, name, ... } }
 */

export interface InfisicalProvisionOptions {
  /** Base URL of the Infisical instance. */
  baseUrl: string;
  /** Bearer token with workspace-create permission. */
  adminToken: string;
  /** Organisation id every per-tenant workspace lives under. */
  organizationId: string;
  /** Fetch — injectable for tests. Defaults to `globalThis.fetch`. */
  fetchImpl?: typeof fetch;
}

export interface CreatedInfisicalProject {
  projectId: string;
  name: string;
}

export class InfisicalProvisionError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
  ) {
    super(message);
    this.name = 'InfisicalProvisionError';
  }
}

/**
 * Creates a per-tenant workspace in the self-hosted Infisical at
 * `infisical.chiefaia.com`. Idempotent at the *caller* level — the
 * orchestrating `provisionTenant` checks the global `tenants` row first,
 * so this is only called for genuinely new tenants. If Infisical returns
 * a duplicate-name error we surface it; the caller can retry with a
 * suffixed name.
 */
export async function createInfisicalProject(
  workspaceName: string,
  opts: InfisicalProvisionOptions,
): Promise<CreatedInfisicalProject> {
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/api/v2/workspace`;
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${opts.adminToken}`,
    },
    body: JSON.stringify({
      workspaceName,
      organizationId: opts.organizationId,
      type: 'production',
    }),
  });
  if (!res.ok) {
    let body: unknown = undefined;
    try {
      body = await res.json();
    } catch {
      // ignored — body may not be JSON
    }
    throw new InfisicalProvisionError(
      `Infisical workspace create failed: HTTP ${res.status}`,
      res.status,
      body,
    );
  }
  const parsed = (await res.json()) as { workspace?: { _id?: string; name?: string } };
  const id = parsed.workspace?._id;
  const name = parsed.workspace?.name;
  if (!id || !name) {
    throw new InfisicalProvisionError(
      'Infisical workspace create returned malformed body (missing _id/name)',
      res.status,
      parsed,
    );
  }
  return { projectId: id, name };
}
