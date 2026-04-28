import type { CheerioAPI } from 'cheerio';
import type { Finding } from '../types.js';

interface JsonLd {
  '@context'?: string;
  '@type'?: string;
  [key: string]: unknown;
}

export function auditSchema(url: string, $: CheerioAPI): Finding[] {
  const findings: Finding[] = [];

  const scriptTags = $('script[type="application/ld+json"]').toArray();

  if (scriptTags.length === 0) {
    findings.push({
      id: 'schema-missing',
      dimension: 'technical',
      severity: 'major',
      url,
      message: 'No JSON-LD structured data found',
      suggestedFix: 'Add Organization, WebSite, and page-specific JSON-LD (Article, FAQPage, etc.)',
      estimatedImpact: 6,
      estimatedEffort: 'M',
    });
    return findings;
  }

  let hasOrg = false;
  let hasWebsite = false;

  for (const el of scriptTags) {
    const raw = $(el).html() ?? '';
    let data: JsonLd | null = null;
    try {
      data = JSON.parse(raw) as JsonLd;
    } catch {
      findings.push({ id: 'schema-invalid-json', dimension: 'technical', severity: 'major', url, message: 'JSON-LD script contains invalid JSON', evidence: raw.slice(0, 100), suggestedFix: 'Fix JSON syntax in ld+json script', estimatedImpact: 5, estimatedEffort: 'S' });
      continue;
    }

    if (!data['@context']?.toString().includes('schema.org')) {
      findings.push({ id: 'schema-no-context', dimension: 'technical', severity: 'minor', url, message: 'JSON-LD missing @context: "https://schema.org"', suggestedFix: 'Add "@context": "https://schema.org" to all JSON-LD blocks', estimatedImpact: 2, estimatedEffort: 'S' });
    }

    const type = data['@type'] as string | undefined;
    if (type === 'Organization') hasOrg = true;
    if (type === 'WebSite') hasWebsite = true;
  }

  if (!hasOrg) {
    findings.push({ id: 'schema-no-organization', dimension: 'technical', severity: 'major', url, message: 'No Organization schema found', suggestedFix: 'Add Organization JSON-LD with name, url, logo, sameAs', estimatedImpact: 4, estimatedEffort: 'M' });
  }

  if (!hasWebsite) {
    findings.push({ id: 'schema-no-website', dimension: 'technical', severity: 'minor', url, message: 'No WebSite schema found (misses SiteLinksSearchBox opportunity)', suggestedFix: 'Add WebSite JSON-LD with name, url, potentialAction SearchAction', estimatedImpact: 3, estimatedEffort: 'M' });
  }

  return findings;
}
