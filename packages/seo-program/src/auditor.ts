import * as cheerio from 'cheerio';
import type { AuditResult, Finding } from './types.js';
import { auditMeta } from './modules/meta.js';
import { auditHeadings } from './modules/headings.js';
import { auditImages } from './modules/images.js';
import { auditLinks } from './modules/links.js';
import { auditSchema } from './modules/schema.js';
import { auditRobots } from './modules/robots.js';
import { auditSitemap } from './modules/sitemap.js';
import { auditSecurity } from './modules/security.js';
import { auditSocial } from './modules/social.js';
import { auditContent } from './modules/content.js';
import { buildResult } from './scorer.js';

export interface AuditOptions {
  timeout?: number;
}

export async function auditUrl(url: string, options: AuditOptions = {}): Promise<AuditResult> {
  const timeout = options.timeout ?? 15000;
  const timestamp = new Date().toISOString();

  // Add performance metric
  const performanceFindings: Finding[] = [];

  // Fetch the page
  let html: string;
  let statusCode: number;
  let ttfb: number;
  let responseHeaders: Record<string, string> = {};

  const t0 = Date.now();
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'SEORunner/1.0 (+https://pokerzeno.com/seo-runner)' },
      redirect: 'follow',
    });
    clearTimeout(timer);
    ttfb = Date.now() - t0;
    statusCode = res.status;
    html = await res.text();

    // Collect headers
    res.headers.forEach((value, key) => {
      responseHeaders[key.toLowerCase()] = value;
    });
  } catch (err) {
    ttfb = Date.now() - t0;
    const errMsg = err instanceof Error ? err.message : String(err);
    return buildResult(url, timestamp, ttfb, 0, [{
      id: 'fetch-failed',
      dimension: 'technical',
      severity: 'critical',
      url,
      message: `Failed to fetch page: ${errMsg}`,
      suggestedFix: 'Ensure the URL is accessible',
      estimatedImpact: 10,
      estimatedEffort: 'M',
    }]);
  }

  if (statusCode >= 400) {
    return buildResult(url, timestamp, ttfb, statusCode, [{
      id: `http-${statusCode}`,
      dimension: 'technical',
      severity: 'critical',
      url,
      message: `Page returned HTTP ${statusCode}`,
      suggestedFix: statusCode === 404 ? 'Page not found — check URL or add redirect' : 'Fix server error',
      estimatedImpact: 10,
      estimatedEffort: 'M',
    }]);
  }

  // TTFB check
  if (ttfb > 1800) {
    performanceFindings.push({ id: 'perf-ttfb-slow', dimension: 'performance', severity: 'major', url, message: `TTFB ${ttfb}ms (target <800ms)`, suggestedFix: 'Optimise server response time; add caching, CDN, reduce server work', estimatedImpact: 6, estimatedEffort: 'L' });
  } else if (ttfb > 800) {
    performanceFindings.push({ id: 'perf-ttfb-moderate', dimension: 'performance', severity: 'minor', url, message: `TTFB ${ttfb}ms (good target <800ms)`, suggestedFix: 'Consider edge caching or CDN to reduce TTFB', estimatedImpact: 2, estimatedEffort: 'M' });
  }

  const $ = cheerio.load(html);

  // Run all audit modules
  const [robotsFindings, sitemapFindings] = await Promise.all([
    auditRobots(url, timeout),
    auditSitemap(url, timeout),
  ]);

  const allFindings: Finding[] = [
    ...auditMeta(url, $, responseHeaders),
    ...auditHeadings(url, $),
    ...auditImages(url, $),
    ...auditLinks(url, $),
    ...auditSchema(url, $),
    ...auditSecurity(url, responseHeaders),
    ...auditSocial(url, $),
    ...auditContent(url, $),
    ...robotsFindings,
    ...sitemapFindings,
    ...performanceFindings,
  ];

  return buildResult(url, timestamp, ttfb, statusCode, allFindings);
}
