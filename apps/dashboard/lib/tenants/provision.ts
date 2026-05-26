/**
 * `provisionTenant(email, displayName)` — the fan-out orchestrator.
 *
 * Responsibilities (in order, with idempotency at each layer):
 *
 *   1. Look up `email` in the global `tenants` table. If present → return
 *      the existing record (idempotent fast-path; covers reload / retry /
 *      concurrent middleware invocations).
 *
 *   2. Create the per-tenant Postgres schema (`CREATE SCHEMA IF NOT EXISTS
 *      tenant_<slug>`). Idempotent by SQL contract.
 *
 *   3. Create the per-tenant Infisical workspace via the admin API at
 *      `infisical.chiefaia.com`. Not natively idempotent — we wrap with a
 *      "already exists → rethrow with `code: 'duplicate'` so the caller can
 *      branch" pattern.
 *
 *   4. Insert the tenant row (`INSERT … ON CONFLICT (email) DO NOTHING`).
 *      Returns `{created: true}` only for the first writer; concurrent
 *      writers fall through to step 5 with `created: false`.
 *
 *   5. Publish `tenant.provisioned` to NATS via `@chiefaia/event-bus-nats`.
 *      Only fires when `created === true` so concurrent writers do NOT
 *      double-emit.
 *
 * Subscription-only LLM discipline: this module has no LLM calls. Safe.
 *
 * Wire-up: the Next.js middleware calls this from the edge runtime. The
 * `deps` object is constructed in a server-only module (lib/tenants/wire.ts)
 * so the middleware can be tree-shake-safe.
 */

import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  TenantStore,
  schemaNameForEmail,
  type TenantRow,
} from './store';
import {
  createInfisicalProject,
  type InfisicalProvisionOptions,
} from './infisical';

/**
 * Subset of @chiefaia/event-bus-nats's EventBus we actually use. Typed
 * structurally to avoid pulling the package's full surface into hot
 * paths and to keep tests injectable.
 */
export interface EventPublisher {
  publish(input: {
    type: string;
    severity?: 'debug' | 'info' | 'warning' | 'error';
    actor?: string;
    payload: Record<string, unknown>;
  }): Promise<unknown>;
}

export interface ProvisionDeps {
  pool: Pool;
  tenantStore: TenantStore;
  infisical: InfisicalProvisionOptions;
  publisher: EventPublisher;
  /** Test injection points. */
  newId?: () => string;
  now?: () => Date;
}

export interface ProvisionResult {
  tenant: TenantRow;
  created: boolean;
}

/** Create the per-tenant Postgres schema idempotently. */
export async function ensureTenantSchema(pool: Pool, schemaName: string): Promise<void> {
  // Use a quoted identifier — schema names are validated by `schemaNameForEmail`
  // to only contain [a-z0-9_], so quoting is defence-in-depth, not a real
  // injection concern.
  const safe = schemaName.replace(/"/g, '');
  await pool.query(`CREATE SCHEMA IF NOT EXISTS "${safe}"`);
}

export async function provisionTenant(
  email: string,
  displayName: string,
  deps: ProvisionDeps,
): Promise<ProvisionResult> {
  const normEmail = email.toLowerCase().trim();
  if (!normEmail || !normEmail.includes('@')) {
    throw new Error(`provisionTenant: invalid email "${email}"`);
  }

  // 1. Fast-path: existing tenant.
  const existing = await deps.tenantStore.findByEmail(normEmail);
  if (existing) {
    return { tenant: existing, created: false };
  }

  const schemaName = schemaNameForEmail(normEmail);
  const tenantId = (deps.newId ?? randomUUID)();
  const workspaceName = `tenant-${tenantId}`;

  // 2. Per-tenant Postgres schema (idempotent via IF NOT EXISTS).
  await ensureTenantSchema(deps.pool, schemaName);

  // 3. Infisical workspace. Not natively idempotent — but step 1's
  //    fast-path catches the common retry case before we get here. If two
  //    concurrent requests race past step 1, we'll get two workspaces and
  //    one tenant row (because step 4 deduplicates) — the losing
  //    workspace becomes an orphan. Operator policy: a daily janitor in
  //    `@caia/devops-runtime` reconciles orphans. Tracked in PLAN.md §6.
  const project = await createInfisicalProject(workspaceName, deps.infisical);

  // 4. Insert the tenants row idempotently.
  const { tenant, created } = await deps.tenantStore.insertIfAbsent({
    tenantId,
    email: normEmail,
    displayName,
    schemaName,
    infisicalProjectId: project.projectId,
  });

  // 5. Fire the bus event — ONLY on the first writer.
  if (created) {
    try {
      await deps.publisher.publish({
        type: 'tenant.provisioned',
        severity: 'info',
        actor: 'api',
        payload: {
          tenant_id: tenant.tenantId,
          email: tenant.email,
          schema_name: tenant.schemaName,
          infisical_project_id: tenant.infisicalProjectId,
        },
      });
    } catch (err) {
      // Bus failures must NOT block the response — the tenant row is
      // the source of truth; consumers re-derive via `pipeline.stage.advanced`
      // or the daily reconciliation cron. We log and move on.
      // eslint-disable-next-line no-console
      console.error('[provisionTenant] publish tenant.provisioned failed:', err);
    }
  }

  return { tenant, created };
}
