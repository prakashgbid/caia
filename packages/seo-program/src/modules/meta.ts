import type { CheerioAPI } from 'cheerio';
import type { Finding } from '../types.js';

export function auditMeta(url: string, $: CheerioAPI, headers: Record<string, string>): Finding[] {
  const findings: Finding[] = [];
  const base = new URL(url);

  // Title
  const title = $('title').first().text().trim();
  if (!title) {
    findings.push({ id: 'meta-title-missing', dimension: 'on-page', severity: 'critical', url, message: 'Page has no <title> tag', evidence: null, suggestedFix: 'Add a unique, descriptive title (30–60 characters)', estimatedImpact: 9, estimatedEffort: 'S' });
  } else if (title.length < 30) {
    findings.push({ id: 'meta-title-short', dimension: 'on-page', severity: 'major', url, message: `Title too short (${title.length} chars): "${title}"`, suggestedFix: 'Expand title to 30–60 characters with primary keyword', estimatedImpact: 4, estimatedEffort: 'S' });
  } else if (title.length > 60) {
    findings.push({ id: 'meta-title-long', dimension: 'on-page', severity: 'minor', url, message: `Title too long (${title.length} chars): "${title}"`, suggestedFix: 'Trim title to ≤60 characters to avoid SERP truncation', estimatedImpact: 2, estimatedEffort: 'S' });
  }

  // Description
  const desc = $('meta[name="description"]').attr('content')?.trim() ?? '';
  if (!desc) {
    findings.push({ id: 'meta-desc-missing', dimension: 'on-page', severity: 'critical', url, message: 'No meta description', suggestedFix: 'Add a unique meta description (120–160 characters)', estimatedImpact: 8, estimatedEffort: 'S' });
  } else if (desc.length < 120) {
    findings.push({ id: 'meta-desc-short', dimension: 'on-page', severity: 'major', url, message: `Meta description too short (${desc.length} chars)`, evidence: desc, suggestedFix: 'Expand to 120–160 characters with primary keyword and CTA', estimatedImpact: 3, estimatedEffort: 'S' });
  } else if (desc.length > 160) {
    findings.push({ id: 'meta-desc-long', dimension: 'on-page', severity: 'minor', url, message: `Meta description too long (${desc.length} chars)`, evidence: desc.slice(0, 80) + '…', suggestedFix: 'Trim to ≤160 characters', estimatedImpact: 1, estimatedEffort: 'S' });
  }

  // Keywords
  const keywords = $('meta[name="keywords"]').attr('content')?.trim();
  if (!keywords) {
    findings.push({ id: 'meta-keywords-missing', dimension: 'on-page', severity: 'minor', url, message: 'No keywords meta tag', suggestedFix: 'Add keywords meta tag (low impact but helps site search engines)', estimatedImpact: 1, estimatedEffort: 'S' });
  }

  // Canonical
  const canonical = $('link[rel="canonical"]').attr('href')?.trim();
  if (!canonical) {
    findings.push({ id: 'canonical-missing', dimension: 'technical', severity: 'major', url, message: 'No canonical URL specified', suggestedFix: 'Add <link rel="canonical" href="…"> to avoid duplicate content', estimatedImpact: 5, estimatedEffort: 'S' });
  } else {
    try {
      const canonUrl = new URL(canonical, base);
      if (canonUrl.hostname !== base.hostname) {
        findings.push({ id: 'canonical-cross-origin', dimension: 'technical', severity: 'major', url, message: `Canonical points to different domain: ${canonUrl.hostname}`, evidence: canonical, suggestedFix: 'Ensure canonical points to the correct domain', estimatedImpact: 6, estimatedEffort: 'S' });
      }
    } catch { /* ignore bad URLs */ }
  }

  // Lang attribute
  const lang = $('html').attr('lang');
  if (!lang) {
    findings.push({ id: 'html-lang-missing', dimension: 'technical', severity: 'major', url, message: 'Missing lang attribute on <html>', suggestedFix: 'Add lang="en" to <html>', estimatedImpact: 3, estimatedEffort: 'S' });
  }

  // Viewport
  const viewport = $('meta[name="viewport"]').attr('content');
  if (!viewport) {
    findings.push({ id: 'viewport-missing', dimension: 'technical', severity: 'critical', url, message: 'No viewport meta tag — not mobile-friendly', suggestedFix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">', estimatedImpact: 9, estimatedEffort: 'S' });
  }

  // robots meta
  const robotsMeta = $('meta[name="robots"]').attr('content')?.toLowerCase() ?? '';
  if (robotsMeta.includes('noindex')) {
    findings.push({ id: 'meta-noindex', dimension: 'technical', severity: 'critical', url, message: 'Page is set to noindex — will not appear in search results', evidence: robotsMeta, suggestedFix: 'Remove noindex directive or change to "index,follow"', estimatedImpact: 10, estimatedEffort: 'S' });
  }

  return findings;
}
