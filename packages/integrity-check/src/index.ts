import * as path from 'path';
import { runStaticScan } from './static/scan';
import { runCrawl } from './crawl/index';
import { runClickthrough } from './runtime/clickthrough';
import { discoverStaticRoutes } from './crawl/route-discovery';
import type { ScanOptions, ScanResult, Issue } from './types';

export type { ScanOptions, ScanResult, Issue };
export { runStaticScan } from './static/scan';
export { runCrawl } from './crawl/index';
export { runClickthrough } from './runtime/clickthrough';
export { discoverRoutes, discoverStaticRoutes } from './crawl/route-discovery';
export { extractAllLinks } from './crawl/link-extractor';
export { probe, probeAll } from './crawl/probe';
export { printTerminalReport, renderReport } from './report/terminal';
export { writeJsonReport, readJsonReport } from './report/json';

/** Run all enabled scan layers and return a consolidated ScanResult. */
export async function runScan(projectDir: string, opts: ScanOptions = {}): Promise<ScanResult> {
  const absDir = path.resolve(projectDir);
  const issues: Issue[] = [];
  let filesScanned = 0;
  let routesChecked = 0;
  let fixed = 0;

  if (!opts.crawlOnly && !opts.runtimeOnly) {
    const staticResult = await runStaticScan(absDir, opts.fix);
    issues.push(...staticResult.issues);
    filesScanned = staticResult.filesScanned;
    fixed = staticResult.issues.filter((i) => i.fixed).length;
  }

  if (!opts.staticOnly && !opts.runtimeOnly) {
    const crawlResult = await runCrawl(absDir, opts.baseUrl);
    issues.push(...crawlResult.issues);
    routesChecked = crawlResult.routesChecked;
  }

  if (opts.runtimeOnly || (opts.baseUrl && !opts.staticOnly && !opts.crawlOnly)) {
    if (opts.baseUrl) {
      const routes = await discoverStaticRoutes(absDir);
      const rtResult = await runClickthrough({
        baseUrl: opts.baseUrl,
        routes,
        waitMs: 500,
      });
      issues.push(...rtResult.issues);
      routesChecked += rtResult.routesTested;
    }
  }

  return {
    projectDir: absDir,
    timestamp: new Date().toISOString(),
    issues,
    stats: {
      filesScanned,
      routesChecked,
      issuesFound: issues.length,
      errors: issues.filter((i) => i.severity === 'error' && !i.fixed).length,
      warnings: issues.filter((i) => i.severity === 'warning' && !i.fixed).length,
      fixed,
    },
  };
}
