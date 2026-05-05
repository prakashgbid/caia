/**
 * Status dashboard HTTP server.
 *
 * Bound to localhost only (127.0.0.1) — no auth needed because the host
 * boundary IS the auth boundary, matching the pattern used by the CAIA
 * orchestrator + dashboard.
 *
 * Routes:
 *   GET  /                      — static HTML page (DASHBOARD_HTML)
 *   GET  /api/status            — JSON list of all sites + per-site state
 *   GET  /api/logs/<site>       — last N lines of incident log for a site
 *   POST /api/redeploy/<site>   — enqueue a forced deploy for a site
 *   POST /api/rollback/<site>   — manual rollback (current ← previous, restart)
 *   GET  /healthz               — 200 OK if server is up (for plist KeepAlive)
 *
 * Trust boundary: site names supplied via URL path are validated against the
 * compile-time SITES registry; unknown names return 404. No path is ever
 * passed to a shell or to fs functions outside the install root.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { URL } from 'node:url';

import { rollbackToPrevious } from './atomic-swap.js';
import { deploySite, resolveSitePath, type DeployOptions, type DeployResult } from './deploy.js';
import { SITES, type SiteConfig } from './sites-config.js';
import { defaultSiteState, readSiteState, updateSiteState, type SiteState } from './site-state.js';
import { DASHBOARD_HTML } from './dashboard-html.js';

export interface StatusDashboardOptions {
  /** Per-site install root, e.g. ~/Library/Application Support/Stolution/local-preview/ */
  installRoot: string;
  /** Listen host. Default: 127.0.0.1 (localhost-only). */
  host?: string;
  /** Listen port. 0 = pick ephemeral (test-friendly). Default: 5170. */
  port?: number;
  /** Sites to surface. Default: SITES (compile-time registry). */
  sites?: SiteConfig[];
  /** Deploy options used by manual /api/redeploy. Required if redeploy is enabled. */
  deployOptions?: Omit<DeployOptions, 'force'>;
  /** Override the deploy fn (test injection). */
  deployFn?: (site: SiteConfig, opts: DeployOptions) => Promise<DeployResult>;
  /** Override rollback fn (test injection). */
  rollbackFn?: (sitePath: string) => { success: boolean; error?: string; currentTarget?: string };
  /** Logger. */
  logger?: { info: (m: string) => void; error: (m: string, c?: unknown) => void };
  /** Max lines to return from /api/logs/<site>. Default: 200. */
  logsTailLines?: number;
}

export interface StatusResponse {
  sites: SiteState[];
  generated_at: string;
}

const consoleLogger = {
  info: (m: string): void => console.log(m),
  error: (m: string, c?: unknown): void => {
    if (c !== undefined) console.error(m, c);
    else console.error(m);
  }
};

/**
 * Build the status response from per-site state files.
 */
export function buildStatus(installRoot: string, sites: SiteConfig[]): StatusResponse {
  const sitesState = sites.map((site) => {
    const sitePath = resolveSitePath(installRoot, site.name);
    if (!existsSync(sitePath)) {
      return defaultSiteState(site.name, site.port);
    }
    return readSiteState(sitePath, { name: site.name, port: site.port });
  });
  return {
    sites: sitesState,
    generated_at: new Date().toISOString()
  };
}

/**
 * Read the last N lines of the incident log for a site.
 * Returns an empty array if the log doesn't exist (no incidents yet).
 */
export function readLogTail(
  installRoot: string,
  siteName: string,
  maxLines: number
): { lines: string[] } {
  // nosemgrep: javascript.lang.security.audit.path-traversal.path-join-resolve-traversal.path-join-resolve-traversal -- installRoot from compile-time SITES registry; siteName validated against SITES.
  const logFile = join(installRoot, '_incidents', `${siteName}.jsonl`);
  if (!existsSync(logFile)) return { lines: [] };
  try {
    const raw = readFileSync(logFile, 'utf-8');
    const all = raw.split('\n').filter((l) => l.length > 0);
    return { lines: all.slice(-maxLines) };
  } catch {
    return { lines: [] };
  }
}

/**
 * Manual rollback path — swap symlink and update site state.
 * Returns the new SiteState reflecting the rollback.
 */
export function manualRollback(
  installRoot: string,
  site: SiteConfig,
  rollbackFn: (sitePath: string) => { success: boolean; error?: string; currentTarget?: string }
): { ok: boolean; error?: string; state?: SiteState } {
  const sitePath = resolveSitePath(installRoot, site.name);
  if (!existsSync(sitePath)) {
    return { ok: false, error: 'site has no install dir yet' };
  }
  const result = rollbackFn(sitePath);
  if (!result.success) {
    return { ok: false, error: result.error ?? 'rollback failed' };
  }
  const newSha = extractShaFromBuildPath(result.currentTarget ?? '');
  const stateUpdate: Partial<SiteState> = {
    last_deploy_status: 'success',
    last_deploy_at: new Date().toISOString(),
    last_deploy_error: null
  };
  if (newSha !== undefined) stateUpdate.current_sha = newSha;
  const next = updateSiteState(sitePath, { name: site.name, port: site.port }, stateUpdate);
  return { ok: true, state: next };
}

function extractShaFromBuildPath(buildPath: string): string | undefined {
  const m = /(?:^|\/)builds\/([0-9a-f]{7,40})(?:\/?$)/.exec(buildPath);
  return m?.[1];
}

// ─── Request handling ─────────────────────────────────────────────────────

function send(res: ServerResponse, code: number, body: string, contentType: string): void {
  res.statusCode = code;
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'no-store');
  res.end(body);
}

function sendJson(res: ServerResponse, code: number, body: unknown): void {
  send(res, code, JSON.stringify(body), 'application/json; charset=utf-8');
}

/**
 * Validate a site name against the configured registry.
 */
function findSite(siteName: string, sites: SiteConfig[]): SiteConfig | undefined {
  return sites.find((s) => s.name === siteName);
}

export async function handleRequest(
  req: IncomingMessage,
  res: ServerResponse,
  opts: StatusDashboardOptions
): Promise<void> {
  const sites = opts.sites ?? SITES;
  const logger = opts.logger ?? consoleLogger;

  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  const method = req.method ?? 'GET';

  try {
    // Static HTML
    if (method === 'GET' && url.pathname === '/') {
      send(res, 200, DASHBOARD_HTML, 'text/html; charset=utf-8');
      return;
    }

    if (method === 'GET' && url.pathname === '/healthz') {
      send(res, 200, 'ok', 'text/plain; charset=utf-8');
      return;
    }

    if (method === 'GET' && url.pathname === '/api/status') {
      sendJson(res, 200, buildStatus(opts.installRoot, sites));
      return;
    }

    // /api/logs/<site>
    const logsMatch = /^\/api\/logs\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (method === 'GET' && logsMatch) {
      const siteName = logsMatch[1] ?? '';
      const site = findSite(siteName, sites);
      if (!site) {
        sendJson(res, 404, { error: 'unknown site', site: siteName });
        return;
      }
      const tail = readLogTail(opts.installRoot, site.name, opts.logsTailLines ?? 200);
      sendJson(res, 200, tail);
      return;
    }

    // /api/redeploy/<site>
    const redeployMatch = /^\/api\/redeploy\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (method === 'POST' && redeployMatch) {
      const siteName = redeployMatch[1] ?? '';
      const site = findSite(siteName, sites);
      if (!site) {
        sendJson(res, 404, { error: 'unknown site', site: siteName });
        return;
      }
      if (!opts.deployOptions) {
        sendJson(res, 503, { error: 'deploy not configured on this dashboard instance' });
        return;
      }
      const fn = opts.deployFn ?? deploySite;
      const result = await fn(site, { ...opts.deployOptions, force: true });
      sendJson(res, 200, { result });
      return;
    }

    // /api/rollback/<site>
    const rollbackMatch = /^\/api\/rollback\/([A-Za-z0-9_-]+)$/.exec(url.pathname);
    if (method === 'POST' && rollbackMatch) {
      const siteName = rollbackMatch[1] ?? '';
      const site = findSite(siteName, sites);
      if (!site) {
        sendJson(res, 404, { error: 'unknown site', site: siteName });
        return;
      }
      const rb = opts.rollbackFn ?? rollbackToPrevious;
      const result = manualRollback(opts.installRoot, site, rb);
      const code = result.ok ? 200 : 409;
      sendJson(res, code, result);
      return;
    }

    sendJson(res, 404, { error: 'not found', path: url.pathname });
  } catch (err) {
    logger.error('[status-dashboard] handler threw', err);
    if (!res.headersSent) {
      sendJson(res, 500, {
        error: 'internal',
        message: err instanceof Error ? err.message : String(err)
      });
    }
  }
}

/**
 * Build (but do not start) the HTTP server. Tests call `.listen(0)` to bind
 * an ephemeral port and `.close()` afterwards.
 */
export function createDashboardServer(opts: StatusDashboardOptions): Server {
  return createServer((req, res) => {
    void handleRequest(req, res, opts);
  });
}

/**
 * Start the dashboard, blocking until it begins listening. Returns the bound
 * server so callers can `.close()` for graceful shutdown.
 */
export function startDashboard(opts: StatusDashboardOptions): Promise<Server> {
  const server = createDashboardServer(opts);
  const host = opts.host ?? '127.0.0.1';
  const port = opts.port ?? 5170;
  return new Promise<Server>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.removeListener('error', reject);
      resolve(server);
    });
  });
}

