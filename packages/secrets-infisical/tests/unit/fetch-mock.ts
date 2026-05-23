/**
 * Hand-rolled fetch mock for the InfisicalSecretsAdapter unit tests.
 *
 * Simulates enough of the Infisical V3 surface to round-trip put/get/
 * patch/delete/list. Not pretending to be the real backend — only
 * needs to be faithful to the request shapes the adapter emits.
 */

export interface FetchCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

interface SecretRecord {
  id: string;
  workspaceId: string;
  environment: string;
  secretPath: string;
  secretKey: string;
  secretValue: string;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export class MockInfisicalServer {
  public calls: FetchCall[] = [];
  public secrets: SecretRecord[] = [];
  public loginCount = 0;
  public failNext: { match: RegExp; status: number; body?: string } | null = null;
  public requireCfHeaders = false;
  public expiredOnFirstUse = false;
  private nextId = 1;

  reset(): void {
    this.calls = [];
    this.secrets = [];
    this.loginCount = 0;
    this.failNext = null;
    this.expiredOnFirstUse = false;
  }

  fetchImpl: typeof fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : (input as URL).toString();
    const method = init?.method ?? 'GET';
    const headers = headersToRecord(init?.headers);
    const body =
      init?.body && typeof init.body === 'string'
        ? safeJsonParse(init.body)
        : undefined;
    this.calls.push({ url, method, headers, body });

    if (this.requireCfHeaders) {
      if (
        !headers['CF-Access-Client-Id'] ||
        !headers['CF-Access-Client-Secret']
      ) {
        return jsonResponse(403, { message: 'CF Access required' });
      }
    }

    if (this.failNext && this.failNext.match.test(url)) {
      const f = this.failNext;
      this.failNext = null;
      return new Response(f.body ?? '', { status: f.status });
    }

    // Login endpoint
    if (url.endsWith('/api/v1/auth/universal-auth/login')) {
      this.loginCount += 1;
      const reqBody = (body ?? {}) as { clientId?: string; clientSecret?: string };
      if (!reqBody.clientId || !reqBody.clientSecret) {
        return jsonResponse(400, { message: 'bad creds' });
      }
      if (reqBody.clientId === 'BAD') {
        return jsonResponse(401, { message: 'unauthorized' });
      }
      return jsonResponse(200, {
        accessToken: `tok_${this.loginCount}`,
        expiresIn: 600,
        accessTokenMaxTTL: 600,
        tokenType: 'Bearer',
      });
    }

    // Status / health
    if (url.includes('/api/status')) {
      return jsonResponse(200, { message: 'ok' });
    }

    // Authenticated endpoints — require bearer
    const bearer = headers['Authorization']?.replace(/^Bearer /, '');
    if (!bearer) return jsonResponse(401, { message: 'no token' });

    // Simulate token revocation: when expiredOnFirstUse, fail tok_1 once.
    if (this.expiredOnFirstUse && bearer === 'tok_1') {
      this.expiredOnFirstUse = false;
      return jsonResponse(401, { message: 'expired' });
    }

    // List
    if (url.includes('/api/v3/secrets/raw?') && method === 'GET') {
      const params = parseQuery(url);
      const rows = this.secrets.filter(
        (s) =>
          s.workspaceId === params.workspaceId &&
          s.environment === params.environment &&
          (params.secretPath === '/' || s.secretPath === params.secretPath),
      );
      return jsonResponse(200, { secrets: rows.map(this.toResponse) });
    }

    // Single secret CRUD: /api/v3/secrets/raw/:name
    const m = url.match(/\/api\/v3\/secrets\/raw\/([^?]+)(?:\?(.*))?$/);
    if (m) {
      const secretName = decodeURIComponent(m[1] ?? '');
      const params = m[2] ? parseQueryString(m[2]) : (body as Record<string, string> | undefined);
      const reqBody = body as Record<string, string> | undefined;
      const ws = (params?.workspaceId ?? reqBody?.workspaceId) as string;
      const env = (params?.environment ?? reqBody?.environment) as string;
      const path = (params?.secretPath ?? reqBody?.secretPath) as string;

      if (method === 'GET') {
        const row = this.secrets.find(
          (s) =>
            s.workspaceId === ws &&
            s.environment === env &&
            s.secretPath === path &&
            s.secretKey === secretName,
        );
        if (!row) return jsonResponse(404, { message: 'not found' });
        return jsonResponse(200, { secret: this.toResponse(row) });
      }
      if (method === 'POST') {
        const conflict = this.secrets.find(
          (s) =>
            s.workspaceId === ws &&
            s.environment === env &&
            s.secretPath === path &&
            s.secretKey === secretName,
        );
        if (conflict) {
          return jsonResponse(400, { message: 'already exists' });
        }
        const id = `inf_${this.nextId++}`;
        const now = new Date().toISOString();
        const row: SecretRecord = {
          id,
          workspaceId: ws,
          environment: env,
          secretPath: path,
          secretKey: secretName,
          secretValue: reqBody?.secretValue as string,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };
        this.secrets.push(row);
        return jsonResponse(200, { secret: this.toResponse(row) });
      }
      if (method === 'PATCH') {
        const row = this.secrets.find(
          (s) =>
            s.workspaceId === ws &&
            s.environment === env &&
            s.secretPath === path &&
            s.secretKey === secretName,
        );
        if (!row) return jsonResponse(404, { message: 'not found' });
        row.secretValue = reqBody?.secretValue as string;
        row.version += 1;
        row.updatedAt = new Date(Date.now() + row.version).toISOString();
        return jsonResponse(200, { secret: this.toResponse(row) });
      }
      if (method === 'DELETE') {
        const idx = this.secrets.findIndex(
          (s) =>
            s.workspaceId === ws &&
            s.environment === env &&
            s.secretPath === path &&
            s.secretKey === secretName,
        );
        if (idx < 0) return jsonResponse(404, { message: 'not found' });
        this.secrets.splice(idx, 1);
        return jsonResponse(200, {});
      }
    }

    return jsonResponse(500, { message: `unrouted ${method} ${url}` });
  };

  private toResponse = (row: SecretRecord) => ({
    id: row.id,
    _id: row.id,
    secretKey: row.secretKey,
    secretValue: row.secretValue,
    secretPath: row.secretPath,
    version: row.version,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function headersToRecord(h: HeadersInit | undefined): Record<string, string> {
  if (!h) return {};
  if (h instanceof Headers) {
    const out: Record<string, string> = {};
    h.forEach((v, k) => {
      out[k] = v;
    });
    return out;
  }
  if (Array.isArray(h)) {
    return Object.fromEntries(h);
  }
  return { ...(h as Record<string, string>) };
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return undefined;
  }
}

function parseQueryString(qs: string): Record<string, string> {
  const params = new URLSearchParams(qs);
  const out: Record<string, string> = {};
  params.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function parseQuery(url: string): Record<string, string> {
  const u = new URL(url, 'http://x');
  return parseQueryString(u.search.slice(1));
}
