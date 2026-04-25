import type { CheerioAPI } from 'cheerio';
import type { Finding } from '../types.js';

export function auditLinks(url: string, $: CheerioAPI): Finding[] {
  const findings: Finding[] = [];
  const base = new URL(url);

  const anchors = $('a[href]').toArray();
  const internal: string[] = [];
  const external: string[] = [];
  const noText: string[] = [];
  const newTab: string[] = [];

  for (const el of anchors) {
    const href = $(el).attr('href') ?? '';
    const text = $(el).text().trim();
    const target = $(el).attr('target');
    const rel = $(el).attr('rel') ?? '';

    if (!text && !$(el).find('img').length) {
      noText.push(href);
    }

    if (href.startsWith('http://') || href.startsWith('https://')) {
      try {
        const linkUrl = new URL(href);
        if (linkUrl.hostname === base.hostname) {
          internal.push(href);
        } else {
          external.push(href);
          if (target === '_blank' && !rel.includes('noopener')) {
            newTab.push(href);
          }
        }
      } catch { /* ignore */ }
    } else if (href.startsWith('/') || href.startsWith('./') || href.startsWith('../')) {
      internal.push(href);
    }
  }

  if (internal.length === 0 && anchors.length > 0) {
    findings.push({ id: 'links-no-internal', dimension: 'on-page', severity: 'major', url, message: 'No internal links found — poor site architecture signal', suggestedFix: 'Add internal links to key pages (learn, play, community, etc.)', estimatedImpact: 4, estimatedEffort: 'M' });
  }

  if (noText.length > 0) {
    findings.push({ id: 'links-no-text', dimension: 'on-page', severity: 'minor', url, message: `${noText.length} link(s) have no anchor text`, evidence: noText.slice(0, 3), suggestedFix: 'Add descriptive anchor text to all links', estimatedImpact: 2, estimatedEffort: 'S' });
  }

  if (newTab.length > 0) {
    findings.push({ id: 'links-external-no-noopener', dimension: 'security', severity: 'minor', url, message: `${newTab.length} external links open in new tab without rel="noopener noreferrer"`, evidence: newTab.slice(0, 3), suggestedFix: 'Add rel="noopener noreferrer" to all target="_blank" links', estimatedImpact: 2, estimatedEffort: 'S' });
  }

  return findings;
}
