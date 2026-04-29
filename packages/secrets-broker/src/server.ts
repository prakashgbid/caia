/**
 * Lightweight HTTP broker for edge workers / CI that cannot SSH to stolution.
 * Binds on localhost:7788 by default. Expose via Cloudflare Access tunnel only.
 *
 * Auth: Authorization: Bearer <BROKER_TOKEN>
 * Rate limit: 60 req / min per IP (in-memory)
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fetchSecret, fetchEnv } from './client.js';
import { getAuditLog, hashKey } from './events.js';
import type { RateLimitEntry } from './types.js';
import { logger } from './logger.js';

const PORT = parseInt(process.env['BROKER_PORT'] ?? '7788', 10);
const HOST = process.env['BROKER_HOST'] ?? '127.0.0.1';
const RATE_LIMIT_MAX = parseInt(process.env['BROKER_RATE_LIMIT'] ?? '60', 10);
const RATE_WINDOW_MS = 60_000;

const log = logger.child({ component: 'server' });
const rateLimitMap = new Map<string, RateLimitEntry>();

function getToken(): string {
  const envToken = process.env['BROKER_TOKEN'];
  if (envToken) return envToken;
  const f = join(homedir(), '.vault-token');
  if (existsSync(f)) return readFileSync(f, 'utf8').trim();
  return '';
}

function checkAuth(req: IncomingMessage): boolean {
  const token = getToken();
  if (!token) return false;
  const auth = req.headers['authorization'] ?? '';
  return auth === `Bearer ${token}`;
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);
  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (entry.count >= RATE_LIMIT_MAX) return false;
  entry.count++;
  return true;
}

function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string') return fwd.split(',')[0]?.trim() ?? '?';
  return req.socket.remoteAddress ?? '?';
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(payload);
}

function dashboardHtml(auditEntries: ReturnType<typeof getAuditLog>): string {
  const rows = [...auditEntries].reverse().slice(0, 30).map(e =>
    `<tr><td>${e.timestamp}</td><td>${e.event}</td><td class="hash">${e.secret_key_hash}</td><td>${e.site_slug}</td><td>${e.caller_module}</td><td>${e.cached ? '✓' : '—'}</td></tr>`
  ).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>Secrets Broker</title>
<style>
  body{font-family:monospace;background:#111;color:#eee;margin:2rem}
  h1{color:#7ee7a0}table{border-collapse:collapse;width:100%;font-size:0.85rem}
  th,td{padding:6px 10px;border-bottom:1px solid #333;text-align:left}
  th{color:#aaa;font-size:0.75rem;text-transform:uppercase;letter-spacing:.05em}
  .hash{color:#f9a825;font-size:0.78rem}.badge{padding:2px 8px;border-radius:3px;font-size:.75rem}
  .ok{background:#1a3d1a;color:#7ee7a0}.warn{background:#3d2a00;color:#f9a825}
  .header{display:flex;gap:2rem;margin-bottom:1.5rem}
  .card{background:#1e1e1e;border:1px solid #333;border-radius:6px;padding:1rem;min-width:140px}
  .card h3{margin:0 0 .5rem;font-size:.75rem;color:#888;text-transform:uppercase}
  .card .val{font-size:1.5rem;color:#7ee7a0}
</style></head>
<body>
<h1>Secrets Broker</h1>
<div class="header">
  <div class="card"><h3>Status</h3><div class="val"><span class="badge ok">● online</span></div></div>
  <div class="card"><h3>Port</h3><div class="val">${PORT}</div></div>
  <div class="card"><h3>Recent fetches</h3><div class="val">${auditEntries.length}</div></div>
</div>
<h2 style="font-size:1rem;color:#aaa">Audit log (last 30)</h2>
<table>
  <thead><tr><th>Timestamp</th><th>Event</th><th>Key hash</th><th>Site</th><th>Caller</th><th>Cached</th></tr></thead>
  <tbody>${rows || '<tr><td colspan="6" style="color:#555">No fetches yet</td></tr>'}</tbody>
</table>
</body></html>`;
}

async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const ip = clientIp(req);
  const url = new URL(req.url ?? '/', `http://${HOST}`);
  const path = url.pathname;

  if (path === '/health') {
    json(res, 200, { status: 'ok', ts: new Date().toISOString() });
    return;
  }

  if (path === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(dashboardHtml(getAuditLog()));
    return;
  }

  if (!checkRateLimit(ip)) {
    log.warn('rate limit exceeded', { ip });
    json(res, 429, { error: 'rate limit exceeded' });
    return;
  }

  if (!checkAuth(req)) {
    const dummyHash = hashKey(path);
    log.warn('access denied — bad token', { caller_ip: ip, secret_key_hash: dummyHash });
    json(res, 401, { error: 'unauthorized' });
    return;
  }

  // GET /secrets/:key
  const secretMatch = path.match(/^\/secrets\/([^/]+)$/);
  if (secretMatch && req.method === 'GET') {
    const key = decodeURIComponent(secretMatch[1]!);
    const siteSlug = url.searchParams.get('site') ?? 'default';
    const callerModule = url.searchParams.get('caller') ?? 'http-client';
    try {
      const result = await fetchSecret(key, { siteSlug, callerModule });
      const { value: _v, ...safe } = result;
      json(res, 200, { ...safe, value: result.public ? result.value : '[use HTTPS tunnel]' });
    } catch (err) {
      json(res, 404, { error: err instanceof Error ? err.message : 'fetch failed' });
    }
    return;
  }

  // GET /secrets (list key names only — never values)
  if (path === '/secrets' && req.method === 'GET') {
    json(res, 200, { note: 'Use /secrets/:key to fetch a specific secret' });
    return;
  }

  // GET /audit
  if (path === '/audit' && req.method === 'GET') {
    json(res, 200, { entries: getAuditLog() });
    return;
  }

  // GET /env/:site — returns KEY=value lines for a full site bundle
  const envMatch = path.match(/^\/env\/([^/]+)$/);
  if (envMatch && req.method === 'GET') {
    const siteSlug = decodeURIComponent(envMatch[1]!);
    try {
      const env = await fetchEnv(siteSlug);
      const lines = Object.entries(env).map(([k, v]) => `${k}=${v}`).join('\n');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(lines);
    } catch (err) {
      json(res, 404, { error: err instanceof Error ? err.message : 'fetch-env failed' });
    }
    return;
  }

  json(res, 404, { error: 'not found' });
}

export function startServer(port = PORT, host = HOST): Promise<{ port: number; close: () => Promise<void> }> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => {
      handleRequest(req, res).catch(err => {
        log.error('unhandled request error', { err: err instanceof Error ? err.message : String(err) });
        res.writeHead(500);
        res.end(JSON.stringify({ error: 'internal error' }));
      });
    });

    server.once('error', reject);
    server.listen(port, host, () => {
      log.info('secrets-broker server started', { port, host });
      resolve({
        port,
        close: () => new Promise((r, e) => server.close(err => (err ? e(err) : r()))),
      });
    });
  });
}

// Run directly
if (process.argv[1]?.includes('server')) {
  startServer().then(({ port }) => {
    log.info('broker ready', { port });
  }).catch(err => {
    log.error('failed to start server', { err: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  });
}
