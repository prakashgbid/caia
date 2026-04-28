import type { CheerioAPI } from 'cheerio';
import type { Finding } from '../types.js';

export function auditContent(url: string, $: CheerioAPI): Finding[] {
  const findings: Finding[] = [];

  // Extract body text (exclude nav, footer, scripts)
  const bodyClone = $('body').clone();
  bodyClone.find('script, style, nav, footer, header').remove();
  const text = bodyClone.text().replace(/\s+/g, ' ').trim();
  const wordCount = text.split(/\s+/).filter(w => w.length > 0).length;

  if (wordCount < 300) {
    findings.push({
      id: 'content-thin',
      dimension: 'content',
      severity: wordCount < 100 ? 'critical' : 'major',
      url,
      message: `Thin content: only ${wordCount} words on page (min 300 recommended)`,
      suggestedFix: 'Expand content to at least 300 words with relevant keywords and value',
      estimatedImpact: 7,
      estimatedEffort: 'L',
    });
  } else if (wordCount < 600) {
    findings.push({
      id: 'content-short',
      dimension: 'content',
      severity: 'minor',
      url,
      message: `Page has ${wordCount} words — consider expanding for better topical depth`,
      suggestedFix: 'Aim for 600–1200 words on key pages for topical authority',
      estimatedImpact: 3,
      estimatedEffort: 'L',
    });
  }

  // Check for analytics script (Cloudflare, Plausible, GA4)
  const html = $.html();
  const hasCloudflareAnalytics = html.includes('static.cloudflareinsights.com') || html.includes('beacon.min.js');
  const hasPlausible = html.includes('plausible.io');
  const hasGA4 = html.includes('googletagmanager.com') || html.includes('gtag(');

  if (!hasCloudflareAnalytics && !hasPlausible && !hasGA4) {
    findings.push({
      id: 'analytics-missing',
      dimension: 'content',
      severity: 'major',
      url,
      message: 'No analytics script detected (Cloudflare, Plausible, or GA4)',
      suggestedFix: 'Add Cloudflare Web Analytics (free, privacy-first) — add the beacon script to layout',
      estimatedImpact: 5,
      estimatedEffort: 'S',
    });
  }

  // Favicon
  const hasFavicon = $('link[rel="icon"], link[rel="shortcut icon"], link[rel="apple-touch-icon"]').length > 0;
  if (!hasFavicon) {
    findings.push({ id: 'favicon-missing', dimension: 'on-page', severity: 'minor', url, message: 'No favicon found', suggestedFix: 'Add favicon.svg or favicon.ico', estimatedImpact: 1, estimatedEffort: 'S' });
  }

  return findings;
}
