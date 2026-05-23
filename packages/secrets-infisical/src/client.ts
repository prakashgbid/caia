/**
 * Thin Infisical V3 HTTP client used by the adapter.
 *
 * Endpoints in use (self-hosted, all v3 unless noted):
 *
 *   POST   /api/v3/secrets/raw/{secretName}       - create
 *   GET    /api/v3/secrets/raw/{secretName}       - get one
 *   PATCH  /api/v3/secrets/raw/{secretName}       - update (rotate)
 *   DELETE /api/v3/secrets/raw/{secretName}       - delete
 *   GET    /api/v3/secrets/raw                    - list
 *   GET    /api/status                            - ping
 */

import {
  SecretNotFoundError,
  SecretPolicyDeniedError,
  SecretProviderError,
  SecretRateLimitedError,
} from '@caia/secrets-adapter';
import type { InfisicalAuth } from './auth.js';

export interface InfisicalRawSecret {
  id?: string;
  _id?: string;
  secretKey: string;
  secretValue: string;
  secretPath: string;
  secretComment?: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface ListSecretsParams {
  workspaceId: string;
  environment: string;
  secretPath: string;
}

export interface GetSecretParams extends ListSecretsParams {
  secretName: string;
}

export interface PutSecretParams extends GetSecretParams {
  secretValue: string;
  type?: 'shared' | 'personal';
  secretComment?: string;
}

export interface UpdateSecretParams extends GetSecretParams {
  secretValue: string;
}

export interface DeleteSecretParams extends GetSecretParams {
  type?: 'shared' | 'personal';
}

export interface InfisicalClientOptions {
  baseUrl: string;
  auth: InfisicalAuth;
  fetchImpl?: typeof fetch;
}

export class InfisicalClient {
  private readonly baseUrl: string;
  private readonly auth: InfisicalAuth;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: InfisicalClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, '');
    this.auth = opts.auth;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  }

  private async request(
    method: string,
    pathAndQuery: string,
    body?: unknown,
  ): Promise<Response> {
    const url = `${this.baseUrl}${pathAndQuery}`;
    const doFetch = async (): Promise<Response> => {
      const headers = await this.auth.authorizedHeaders();
      return this.fetchImpl(url, {
        method,
        headers,
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
    };
    let res = await doFetch();
    if (res.status === 401) {
      this.auth.invalidate();
      res = await doFetch();
    }
    return res;
  }

  private async throwForResponse(
    res: Response,
    context: { tenantId?: string; category?: string; key?: string },
  ): Promise<never> {
    const bodyText = await res.text().catch(() => '');
    const trace = bodyText.slice(0, 500);
    if (res.status === 404) {
      throw new SecretNotFoundError(
        `Infisical: not found (${res.status}) ${trace}`,
        context,
      );
    }
    if (res.status === 403 || res.status === 401) {
      throw new SecretPolicyDeniedError(
        `Infisical: forbidden (${res.status}) ${trace}`,
        context,
      );
    }
    if (res.status === 429) {
      const retryAfterHeader = res.headers.get('retry-after');
      const retryAfterMs =
        retryAfterHeader && /^\d+$/.test(retryAfterHeader)
          ? Number(retryAfterHeader) * 1000
          : undefined;
      throw new SecretRateLimitedError(
        `Infisical: rate-limited (${res.status}) ${trace}`,
        { ...context, ...(retryAfterMs !== undefined ? { retryAfterMs } : {}) },
      );
    }
    throw new SecretProviderError(
      `Infisical: provider error (${res.status} ${res.statusText}) ${trace}`,
      context,
    );
  }

  async getSecret(p: GetSecretParams): Promise<InfisicalRawSecret> {
    const qs = new URLSearchParams({
      workspaceId: p.workspaceId,
      environment: p.environment,
      secretPath: p.secretPath,
    }).toString();
    const res = await this.request(
      'GET',
      `/api/v3/secrets/raw/${encodeURIComponent(p.secretName)}?${qs}`,
    );
    if (!res.ok) {
      await this.throwForResponse(res, { key: p.secretName });
    }
    const body = (await res.json()) as { secret: InfisicalRawSecret };
    return body.secret;
  }

  async putSecret(p: PutSecretParams): Promise<InfisicalRawSecret> {
    const res = await this.request(
      'POST',
      `/api/v3/secrets/raw/${encodeURIComponent(p.secretName)}`,
      {
        workspaceId: p.workspaceId,
        environment: p.environment,
        secretPath: p.secretPath,
        secretValue: p.secretValue,
        type: p.type ?? 'shared',
        ...(p.secretComment !== undefined ? { secretComment: p.secretComment } : {}),
      },
    );
    if (!res.ok) {
      await this.throwForResponse(res, { key: p.secretName });
    }
    const body = (await res.json()) as { secret: InfisicalRawSecret };
    return body.secret;
  }

  async updateSecret(p: UpdateSecretParams): Promise<InfisicalRawSecret> {
    const res = await this.request(
      'PATCH',
      `/api/v3/secrets/raw/${encodeURIComponent(p.secretName)}`,
      {
        workspaceId: p.workspaceId,
        environment: p.environment,
        secretPath: p.secretPath,
        secretValue: p.secretValue,
      },
    );
    if (!res.ok) {
      await this.throwForResponse(res, { key: p.secretName });
    }
    const body = (await res.json()) as { secret: InfisicalRawSecret };
    return body.secret;
  }

  async deleteSecret(p: DeleteSecretParams): Promise<void> {
    const qs = new URLSearchParams({
      workspaceId: p.workspaceId,
      environment: p.environment,
      secretPath: p.secretPath,
      ...(p.type !== undefined ? { type: p.type } : {}),
    }).toString();
    const res = await this.request(
      'DELETE',
      `/api/v3/secrets/raw/${encodeURIComponent(p.secretName)}?${qs}`,
    );
    if (!res.ok && res.status !== 404) {
      await this.throwForResponse(res, { key: p.secretName });
    }
  }

  async listSecrets(p: ListSecretsParams): Promise<InfisicalRawSecret[]> {
    const qs = new URLSearchParams({
      workspaceId: p.workspaceId,
      environment: p.environment,
      secretPath: p.secretPath,
    }).toString();
    const res = await this.request('GET', `/api/v3/secrets/raw?${qs}`);
    if (!res.ok) {
      await this.throwForResponse(res, {});
    }
    const body = (await res.json()) as { secrets: InfisicalRawSecret[] };
    return body.secrets ?? [];
  }

  async health(): Promise<{ ok: boolean; latencyMs: number }> {
    const start = Date.now();
    try {
      const url = `${this.baseUrl}/api/status`;
      const res = await this.fetchImpl(url, {
        method: 'GET',
        headers: this.auth.cloudflareAccessHeaders(),
      });
      return { ok: res.ok, latencyMs: Date.now() - start };
    } catch {
      return { ok: false, latencyMs: Date.now() - start };
    }
  }
}
