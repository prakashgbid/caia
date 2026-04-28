/**
 * Cloudflare Pages Function proxy for the stolution secrets broker.
 *
 * Handles: GET /api/_internal/secrets/:key
 *
 * Deploy: copy to <site>/functions/api/_internal/secrets/[key].ts
 * Environment (Pages → Settings → Environment variables, encrypted):
 *   BROKER_TOKEN   — bearer token matching the stolution broker
 *   BROKER_URL     — https://broker.internal (via Cloudflare Access tunnel)
 *
 * This is server-side only — never exposed to the public client bundle.
 * Cache: per-isolate, 60 seconds.
 */

interface Env {
  BROKER_TOKEN: string;
  BROKER_URL: string;
}

interface IsolateCache {
  [key: string]: { value: string; expiresAt: number };
}

// Per-isolate cache — survives warm restarts within the same isolate
const isolateCache: IsolateCache = {};
const CACHE_TTL_MS = 60_000;

function fromIsolateCache(key: string): string | null {
  const entry = isolateCache[key];
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    delete isolateCache[key];
    return null;
  }
  return entry.value;
}

function toIsolateCache(key: string, value: string): void {
  isolateCache[key] = { value, expiresAt: Date.now() + CACHE_TTL_MS };
}

export async function onRequest(context: {
  request: Request;
  params: Record<string, string | string[]>;
  env: Env;
}): Promise<Response> {
  const { request, params, env } = context;

  // Only allow GET from server-side Pages Functions
  if (request.method !== 'GET') {
    return new Response(JSON.stringify({ error: 'method not allowed' }), {
      status: 405,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const key = Array.isArray(params['key']) ? params['key'][0] : params['key'];
  if (!key) {
    return new Response(JSON.stringify({ error: 'missing key' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Check isolate cache first
  const cached = fromIsolateCache(key);
  if (cached !== null) {
    return new Response(JSON.stringify({ value: cached, cached: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'X-Broker-Cache': 'hit' },
    });
  }

  if (!env.BROKER_TOKEN || !env.BROKER_URL) {
    return new Response(JSON.stringify({ error: 'broker not configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const url = new URL(request.url);
  const siteSlug = url.searchParams.get('site') ?? 'default';
  const brokerUrl = `${env.BROKER_URL}/secrets/${encodeURIComponent(key)}?site=${siteSlug}&caller=cf-worker`;

  const upstream = await fetch(brokerUrl, {
    headers: { Authorization: `Bearer ${env.BROKER_TOKEN}` },
  });

  if (!upstream.ok) {
    const body = await upstream.text();
    return new Response(JSON.stringify({ error: `broker error: ${upstream.status}`, detail: body }), {
      status: upstream.status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = (await upstream.json()) as { value?: string };
  if (!data.value) {
    return new Response(JSON.stringify({ error: 'no value returned' }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  toIsolateCache(key, data.value);

  return new Response(JSON.stringify({ value: data.value, cached: false }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'X-Broker-Cache': 'miss' },
  });
}
