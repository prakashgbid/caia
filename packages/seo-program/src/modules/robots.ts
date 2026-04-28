import type { Finding } from '../types.js';

export async function auditRobots(url: string, timeout: number): Promise<Finding[]> {
  const findings: Finding[] = [];
  const base = new URL(url);
  const robotsUrl = `${base.protocol}//${base.host}/robots.txt`;

  let text: string;
  let status: number;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    const res = await fetch(robotsUrl, { signal: ctrl.signal });
    clearTimeout(timer);
    status = res.status;
    text = await res.text();
  } catch {
    findings.push({ id: 'robots-unreachable', dimension: 'technical', severity: 'critical', url, message: `robots.txt not accessible at ${robotsUrl}`, suggestedFix: 'Create a valid robots.txt at the domain root', estimatedImpact: 7, estimatedEffort: 'S' });
    return findings;
  }

  if (status === 404) {
    findings.push({ id: 'robots-missing', dimension: 'technical', severity: 'major', url, message: 'robots.txt returns 404 — crawlers get no guidance', suggestedFix: 'Create robots.txt at public/robots.txt with Sitemap reference', estimatedImpact: 5, estimatedEffort: 'S' });
    return findings;
  }

  if (status !== 200) {
    findings.push({ id: 'robots-bad-status', dimension: 'technical', severity: 'major', url, message: `robots.txt returns HTTP ${status}`, suggestedFix: 'Fix server error serving robots.txt', estimatedImpact: 5, estimatedEffort: 'M' });
    return findings;
  }

  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));

  // Check for disallow all
  const disallowAll = lines.some(l => /^Disallow:\s*\/\s*$/.test(l));
  if (disallowAll) {
    findings.push({ id: 'robots-disallow-all', dimension: 'technical', severity: 'critical', url, message: 'robots.txt disallows ALL crawlers from ALL paths (Disallow: /)', suggestedFix: 'Remove or correct the Disallow: / directive', estimatedImpact: 10, estimatedEffort: 'S' });
  }

  // Check sitemap reference
  const hasSitemap = lines.some(l => /^Sitemap:/i.test(l));
  if (!hasSitemap) {
    findings.push({ id: 'robots-no-sitemap', dimension: 'technical', severity: 'major', url, message: 'robots.txt does not reference the sitemap', suggestedFix: `Add "Sitemap: ${base.protocol}//${base.host}/sitemap.xml" to robots.txt`, estimatedImpact: 4, estimatedEffort: 'S' });
  }

  // Check for User-agent directive
  const hasUserAgent = lines.some(l => /^User-agent:/i.test(l));
  if (!hasUserAgent) {
    findings.push({ id: 'robots-no-user-agent', dimension: 'technical', severity: 'minor', url, message: 'robots.txt has no User-agent directive', suggestedFix: 'Add "User-agent: *" with appropriate Allow/Disallow rules', estimatedImpact: 2, estimatedEffort: 'S' });
  }

  return findings;
}
