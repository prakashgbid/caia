import * as path from 'path';
import { discoverRoutes, discoverStaticRoutes } from './route-discovery';
import { extractAllLinks } from './link-extractor';
import { probeAll } from './probe';
import type { CrawlResult, Issue } from '../types';

const EXTERNAL_ALLOWLIST = [
  'twitter.com', 'x.com', 'discord.com', 'linkedin.com', 'github.com',
  'facebook.com', 'instagram.com', 'youtube.com', 'reddit.com',
];

function isAllowlisted(url: string): boolean {
  return EXTERNAL_ALLOWLIST.some((domain) => url.includes(domain));
}

/**
 * Crawl layer:
 * 1. Discover all Next.js routes from file system
 * 2. Extract all static links from source files
 * 3. Validate internal links point to real routes
 * 4. Optionally HTTP-probe a running server (if baseUrl provided)
 */
export async function runCrawl(projectDir: string, baseUrl?: string): Promise<CrawlResult> {
  const issues: Issue[] = [];
  const routes = await discoverRoutes(projectDir);
  const routeSet = new Set(routes.map((r) => r.urlPath));

  // Add known always-valid paths
  routeSet.add('/');

  const links = await extractAllLinks(projectDir);
  let routesChecked = routeSet.size;

  // Check internal links resolve to known routes
  for (const link of links) {
    if (link.isExternal) continue;

    const href = link.href;
    // Normalize: strip query/hash for route matching
    const routePath = href.split('?')[0].split('#')[0] || '/';

    // Strip trailing slash for comparison (except root)
    const normalized = routePath === '/' ? '/' : routePath.replace(/\/$/, '');

    // Check exact match or dynamic pattern match
    const hasMatch =
      routeSet.has(normalized) ||
      [...routeSet].some((route) => {
        if (!route.includes('[')) return false;
        // Convert [slug] → regex
        const pattern = route.replace(/\[.*?\]/g, '[^/]+');
        return new RegExp(`^${pattern}$`).test(normalized);
      });

    if (!hasMatch) {
      issues.push({
        rule: 'broken-route',
        severity: 'error',
        file: link.sourceFile,
        line: link.line,
        col: 0,
        message: `Link "${href}" points to route "${normalized}" which doesn't exist`,
        fix: 'Create the missing route or update the link to an existing route',
      });
    }
  }

  // HTTP-probe if baseUrl provided (requires running server)
  if (baseUrl) {
    const staticRoutes = await discoverStaticRoutes(projectDir);
    const urls = staticRoutes.map((r) => `${baseUrl}${r}`);
    routesChecked += urls.length;

    const probeResults = await probeAll(urls, 10, 15_000);
    for (const result of probeResults) {
      if (!result.ok) {
        const urlPath = result.url.replace(baseUrl, '');
        issues.push({
          rule: 'http-error',
          severity: 'error',
          file: path.join(projectDir, 'src', 'app', urlPath.slice(1), 'page.tsx'),
          line: 0,
          col: 0,
          message: `HTTP ${result.status || 'ERR'} for ${result.url}${result.error ? ` (${result.error})` : ''}`,
          fix: 'Fix the page or remove the route',
        });
      }
    }
  }

  return { routesChecked, issues };
}
