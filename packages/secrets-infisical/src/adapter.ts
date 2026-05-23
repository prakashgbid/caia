/**
 * `InfisicalSecretsAdapter` - Pattern B from the architecture spec.
 *
 * One Infisical project per tenant. Secrets organized at
 *   secretPath = `/${category}`
 *   secretName = key
 * inside the tenant's project, under a single environment (default `prod`).
 *
 * The tenant->projectId mapping is supplied via a `ProjectResolver`.
 * Audit log writes go to an injected `AuditLogger` (the canonical Postgres
 * one from `@caia/secrets-postgres` works, or NoopAuditLogger for tests).
 */

import {
  AccessContextSchema,
  CategorySchema,
  KeySchema,
  SecretValueSchema,
  TenantIdSchema,
  SecretsAdapterConfigError,
  classifyError,
  type AccessContext,
  type AccessLogEntry,
  type DeleteAllForTenantOptions,
  type DeleteAllResult,
  type DeleteOptions,
  type PingResult,
  type PutOptions,
  type PutResult,
  type RotateResult,
  type SecretMetadata,
  type SecretsAdapter,
} from '@caia/secrets-adapter';

import { InfisicalAuth, type AuthConfig, type CloudflareAccessConfig } from './auth.js';
import { InfisicalClient, type InfisicalRawSecret } from './client.js';
import { NoopAuditLogger, type AuditLogger } from './audit.js';
import { type ProjectResolver } from './project-resolver.js';

export const BACKEND_NAME = 'infisical';

export interface InfisicalSecretsAdapterOptions {
  baseUrl: string;
  auth: AuthConfig;
  cloudflareAccess?: CloudflareAccessConfig;
  projectResolver: ProjectResolver;
  /** Defaults to "prod". */
  environment?: string;
  auditLogger?: AuditLogger;
  /** Override for tests. */
  fetchImpl?: typeof fetch;
  /** Override for tests. */
  now?: () => Date;
}

export class InfisicalSecretsAdapter implements SecretsAdapter {
  private readonly client: InfisicalClient;
  private readonly resolver: ProjectResolver;
  private readonly environment: string;
  private readonly audit: AuditLogger;
  private readonly auditEvents: AccessLogEntry[] = [];

  constructor(opts: InfisicalSecretsAdapterOptions) {
    if (!opts.baseUrl) {
      throw new SecretsAdapterConfigError(
        'InfisicalSecretsAdapter: baseUrl is required',
      );
    }
    if (!opts.projectResolver) {
      throw new SecretsAdapterConfigError(
        'InfisicalSecretsAdapter: projectResolver is required',
      );
    }
    const auth = new InfisicalAuth({
      baseUrl: opts.baseUrl,
      auth: opts.auth,
      ...(opts.cloudflareAccess ? { cloudflareAccess: opts.cloudflareAccess } : {}),
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    this.client = new InfisicalClient({
      baseUrl: opts.baseUrl,
      auth,
      ...(opts.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
    });
    this.resolver = opts.projectResolver;
    this.environment = opts.environment ?? 'prod';
    this.audit = opts.auditLogger ?? new NoopAuditLogger();
  }

  // ---------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------

  private validateIdentifiers(
    tenantId: string,
    category: string,
    key: string,
  ): void {
    TenantIdSchema.parse(tenantId);
    CategorySchema.parse(category);
    KeySchema.parse(key);
  }

  private categoryToPath(category: string): string {
    return `/${category}`;
  }

  private secretRef(raw: InfisicalRawSecret): string {
    return raw.id ?? raw._id ?? `${raw.secretPath}/${raw.secretKey}@v${raw.version}`;
  }

  private toMetadata(raw: InfisicalRawSecret): SecretMetadata {
    // strip leading '/' from secretPath to recover category
    const category = raw.secretPath.replace(/^\//, '') || 'default';
    return {
      key: raw.secretKey,
      category,
      secretRef: this.secretRef(raw),
      createdAt: new Date(raw.createdAt),
      lastRotatedAt: new Date(raw.updatedAt),
      version: raw.version,
    };
  }

  private rememberAudit(entry: AccessLogEntry): void {
    this.auditEvents.push(entry);
    // Cap memory at 10k events; the canonical audit lives in the injected logger.
    if (this.auditEvents.length > 10_000) this.auditEvents.shift();
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - put
  // ---------------------------------------------------------------------

  async put(
    tenantId: string,
    category: string,
    key: string,
    value: string,
    opts?: PutOptions,
  ): Promise<PutResult> {
    this.validateIdentifiers(tenantId, category, key);
    SecretValueSchema.parse(value);
    const workspaceId = await this.resolver.resolve(tenantId);

    let raw: InfisicalRawSecret;
    if (opts?.replace) {
      try {
        raw = await this.client.updateSecret({
          workspaceId,
          environment: this.environment,
          secretPath: this.categoryToPath(category),
          secretName: key,
          secretValue: value,
        });
      } catch (err) {
        // If the secret doesn't exist yet, fall through to create.
        if (
          err &&
          typeof err === 'object' &&
          'errorClass' in err &&
          (err as { errorClass: string }).errorClass === 'not_found'
        ) {
          raw = await this.client.putSecret({
            workspaceId,
            environment: this.environment,
            secretPath: this.categoryToPath(category),
            secretName: key,
            secretValue: value,
          });
        } else {
          throw err;
        }
      }
    } else {
      raw = await this.client.putSecret({
        workspaceId,
        environment: this.environment,
        secretPath: this.categoryToPath(category),
        secretName: key,
        secretValue: value,
      });
    }
    return { secretRef: this.secretRef(raw), version: raw.version };
  }

  async putWithAudit(
    tenantId: string,
    category: string,
    key: string,
    value: string,
    callerContext: AccessContext,
    opts?: PutOptions,
  ): Promise<PutResult> {
    AccessContextSchema.parse(callerContext);
    let result: PutResult | undefined;
    let thrown: unknown;
    try {
      result = await this.put(tenantId, category, key, value, opts);
    } catch (err) {
      thrown = err;
    }
    await this.audit.write({
      tenantId,
      category,
      key,
      backend: BACKEND_NAME,
      action: 'put',
      callerContext,
      ok: thrown === undefined,
      ...(thrown !== undefined ? { errorClass: classifyError(thrown) } : {}),
      ...(result?.secretRef !== undefined
        ? { providerTrace: result.secretRef }
        : {}),
    });
    if (thrown !== undefined) throw thrown;
    return result as PutResult;
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - get
  // ---------------------------------------------------------------------

  async get(
    tenantId: string,
    category: string,
    key: string,
    callerContext: AccessContext,
  ): Promise<string> {
    this.validateIdentifiers(tenantId, category, key);
    AccessContextSchema.parse(callerContext);
    const grantedAt = new Date();
    try {
      const workspaceId = await this.resolver.resolve(tenantId);
      const raw = await this.client.getSecret({
        workspaceId,
        environment: this.environment,
        secretPath: this.categoryToPath(category),
        secretName: key,
      });
      const entry: AccessLogEntry = {
        tenantId,
        category,
        key,
        callerType: callerContext.callerType,
        callerId: callerContext.callerId,
        reason: callerContext.reason,
        grantedAt,
        ok: true,
        providerTrace: this.secretRef(raw),
      };
      if (callerContext.ticketId !== undefined) entry.ticketId = callerContext.ticketId;
      if (callerContext.capabilityTokenId !== undefined)
        entry.capabilityTokenId = callerContext.capabilityTokenId;
      if (callerContext.requesterIp !== undefined)
        entry.requesterIp = callerContext.requesterIp;
      this.rememberAudit(entry);
      await this.audit.write({
        tenantId,
        category,
        key,
        backend: BACKEND_NAME,
        action: 'get',
        callerContext,
        ok: true,
        providerTrace: this.secretRef(raw),
      });
      return raw.secretValue;
    } catch (err) {
      const errorClass = classifyError(err);
      const entry: AccessLogEntry = {
        tenantId,
        category,
        key,
        callerType: callerContext.callerType,
        callerId: callerContext.callerId,
        reason: callerContext.reason,
        grantedAt,
        ok: false,
        errorClass,
      };
      if (callerContext.ticketId !== undefined) entry.ticketId = callerContext.ticketId;
      if (callerContext.capabilityTokenId !== undefined)
        entry.capabilityTokenId = callerContext.capabilityTokenId;
      if (callerContext.requesterIp !== undefined)
        entry.requesterIp = callerContext.requesterIp;
      this.rememberAudit(entry);
      await this.audit.write({
        tenantId,
        category,
        key,
        backend: BACKEND_NAME,
        action: 'get',
        callerContext,
        ok: false,
        errorClass,
      });
      throw err;
    }
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - list
  // ---------------------------------------------------------------------

  async list(tenantId: string, category?: string): Promise<SecretMetadata[]> {
    TenantIdSchema.parse(tenantId);
    if (category !== undefined) CategorySchema.parse(category);
    const workspaceId = await this.resolver.resolve(tenantId);
    // Infisical list is scoped to a single path. If `category` is omitted
    // we list at root and filter by path prefix client-side.
    const raws = await this.client.listSecrets({
      workspaceId,
      environment: this.environment,
      secretPath: category ? this.categoryToPath(category) : '/',
    });
    return raws.map((r) => this.toMetadata(r));
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - rotate
  // ---------------------------------------------------------------------

  async rotate(
    tenantId: string,
    category: string,
    key: string,
  ): Promise<RotateResult> {
    this.validateIdentifiers(tenantId, category, key);
    const workspaceId = await this.resolver.resolve(tenantId);
    // Infisical has no "rotate without new value" primitive; we re-PATCH
    // with the current value, which bumps version + updatedAt — the
    // architecture spec calls this acceptable since the actual key
    // rotation is provider-specific (Stripe, AWS STS, etc.) and the
    // adapter caller supplies the new value via put({replace: true}).
    const current = await this.client.getSecret({
      workspaceId,
      environment: this.environment,
      secretPath: this.categoryToPath(category),
      secretName: key,
    });
    const updated = await this.client.updateSecret({
      workspaceId,
      environment: this.environment,
      secretPath: this.categoryToPath(category),
      secretName: key,
      secretValue: current.secretValue,
    });
    return {
      rotatedAt: new Date(updated.updatedAt),
      version: updated.version,
    };
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - delete
  // ---------------------------------------------------------------------

  async delete(
    tenantId: string,
    category: string,
    key: string,
    _opts?: DeleteOptions,
  ): Promise<void> {
    this.validateIdentifiers(tenantId, category, key);
    const workspaceId = await this.resolver.resolve(tenantId);
    await this.client.deleteSecret({
      workspaceId,
      environment: this.environment,
      secretPath: this.categoryToPath(category),
      secretName: key,
    });
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - deleteAllForTenant
  // ---------------------------------------------------------------------

  async deleteAllForTenant(
    tenantId: string,
    opts?: DeleteAllForTenantOptions,
  ): Promise<DeleteAllResult> {
    TenantIdSchema.parse(tenantId);
    const workspaceId = await this.resolver.resolve(tenantId);
    const allSecrets = await this.client.listSecrets({
      workspaceId,
      environment: this.environment,
      secretPath: '/',
    });
    const tombstoneRef = `tomb_${tenantId}_${Date.now().toString(36)}_${Math.random()
      .toString(36)
      .slice(2, 10)}`;
    if (opts?.dryRun) {
      return {
        deletedCount: allSecrets.length,
        tenantTombstoneRef: `${tombstoneRef}_dryrun`,
      };
    }
    let deleted = 0;
    for (const raw of allSecrets) {
      await this.client.deleteSecret({
        workspaceId,
        environment: this.environment,
        secretPath: raw.secretPath,
        secretName: raw.secretKey,
      });
      deleted += 1;
    }
    return { deletedCount: deleted, tenantTombstoneRef: tombstoneRef };
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - auditLog
  // ---------------------------------------------------------------------

  async auditLog(
    tenantId: string,
    since?: Date,
    until?: Date,
  ): Promise<AccessLogEntry[]> {
    TenantIdSchema.parse(tenantId);
    const sinceMs = since?.getTime() ?? -Infinity;
    const untilMs = until?.getTime() ?? Infinity;
    return this.auditEvents
      .filter((e) => e.tenantId === tenantId)
      .filter((e) => {
        const t = e.grantedAt.getTime();
        return t >= sinceMs && t <= untilMs;
      })
      .slice()
      .reverse();
  }

  // ---------------------------------------------------------------------
  // SecretsAdapter - ping
  // ---------------------------------------------------------------------

  async ping(): Promise<PingResult> {
    const r = await this.client.health();
    return { ok: r.ok, latencyMs: r.latencyMs, backend: BACKEND_NAME };
  }
}
