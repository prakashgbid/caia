import type { Finding } from '../types.js';

export async function auditSitemap(url: string, timeout: number): Promise<Finding[]> {
  const findings: Finding[] = [];
  const base = new URL(url);
  const sitemapUrl = `${base.protocol}//${base.host}/sitemap.xml`;

  let text: string;
  let status: number;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(sitemapUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    status = res.status;
    text = await res.text();
  } catch {
    findings.push({ id: 'sitemap-unreachable', dimension: 'technical', severity: 'major', url, message: `Sitemap not accessible at ${sitemapUrl}`, suggestedFix: 'Ensure sitemap.xml is generated and served at /sitemap.xml', estimatedImpact: 6, estimatedEffort: 'M' });
    return findings;
  }

  if (status === 404) {
    findings.push({ id: 'sitemap-missing', dimension: 'technical', severity: 'major', url, message: 'sitemap.xml returns 404', suggestedFix: 'Create src/app/sitemap.ts (Next.js) to auto-generate sitemap', estimatedImpact: 6, estimatedEffort: 'M' });
    return findings;
  }

  if (!text.includes('<urlset') && !text.includes('<sitemapindex')) {
    findings.push({ id: 'sitemap-invalid-xml', dimension: 'technical', severity: 'major', url, message: 'sitemap.xml does not appear to be valid XML', evidence: text.slice(0, 100), suggestedFix: 'Fix sitemap generation to produce valid XML', estimatedImpact: 6, estimatedEffort: 'M' });
    return findings;
  }

  // Count URLs
  const urlMatches = text.match(/<loc>/g) ?? [];
  const count = urlMatches.length;

  if (count === 0) {
    findings.push({ id: 'sitemap-no-urls', dimension: 'technical', severity: 'major', url, message: 'Sitemap contains no URLs', suggestedFix: 'Ensure all important pages are included in the sitemap', estimatedImpact: 5, estimatedEffort: 'M' });
  } else if (count < 5) {
    findings.push({ id: 'sitemap-few-urls', dimension: 'technical', severity: 'minor', url, message: `Sitemap only has ${count} URL(s) — may be missing pages`, suggestedFix: 'Add all important pages including lesson, publication, and product pages', estimatedImpact: 3, estimatedEffort: 'M' });
  }

  // Check for lastmod
  if (!text.includes('<lastmod>')) {
    findings.push({ id: 'sitemap-no-lastmod', dimension: 'technical', severity: 'minor', url, message: 'Sitemap URLs have no lastmod dates', suggestedFix: 'Add lastmod to sitemap entries for freshness signals', estimatedImpact: 2, estimatedEffort: 'S' });
  }

  // Check for priority/changefreq
  if (!text.includes('<priority>')) {
    findings.push({ id: 'sitemap-no-priority', dimension: 'technical', severity: 'info', url, message: 'Sitemap has no priority values (optional but helpful)', suggestedFix: 'Add priority values (1.0 for homepage, 0.8 for key pages)', estimatedImpact: 1, estimatedEffort: 'S' });
  }

  return findings;
}
