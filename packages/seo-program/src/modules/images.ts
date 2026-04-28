import type { CheerioAPI } from 'cheerio';
import type { Finding } from '../types.js';

export function auditImages(url: string, $: CheerioAPI): Finding[] {
  const findings: Finding[] = [];

  const imgs = $('img').toArray();
  const total = imgs.length;
  if (total === 0) return findings;

  const missingAlt: string[] = [];
  const emptyAlt: string[] = [];
  const missingDimensions: string[] = [];

  for (const el of imgs) {
    const src = $(el).attr('src') ?? '';
    const alt = $(el).attr('alt');
    const hasWidth = $(el).attr('width');
    const hasHeight = $(el).attr('height');

    if (alt === undefined) {
      missingAlt.push(src || '(no src)');
    } else if (alt.trim() === '') {
      // Empty alt is valid for decorative images, but flag non-obvious ones
      const role = $(el).attr('role');
      if (role !== 'presentation' && !src.includes('icon') && !src.includes('logo')) {
        emptyAlt.push(src || '(no src)');
      }
    }

    if (!hasWidth || !hasHeight) {
      missingDimensions.push(src || '(no src)');
    }
  }

  if (missingAlt.length > 0) {
    findings.push({
      id: 'img-alt-missing',
      dimension: 'on-page',
      severity: missingAlt.length > total * 0.3 ? 'critical' : 'major',
      url,
      message: `${missingAlt.length}/${total} images missing alt attribute`,
      evidence: missingAlt.slice(0, 5),
      suggestedFix: 'Add descriptive alt text to all meaningful images',
      estimatedImpact: Math.min(8, Math.ceil(missingAlt.length / total * 8)),
      estimatedEffort: 'M',
    });
  }

  if (emptyAlt.length > 2) {
    findings.push({
      id: 'img-alt-empty',
      dimension: 'on-page',
      severity: 'minor',
      url,
      message: `${emptyAlt.length} images have empty alt text (may be intentional for decorative images)`,
      evidence: emptyAlt.slice(0, 3),
      suggestedFix: 'Verify decorative images have role="presentation"; add alt text to content images',
      estimatedImpact: 2,
      estimatedEffort: 'M',
    });
  }

  if (missingDimensions.length > total * 0.5) {
    findings.push({
      id: 'img-dimensions-missing',
      dimension: 'performance',
      severity: 'minor',
      url,
      message: `${missingDimensions.length}/${total} images missing width/height (causes layout shift)`,
      suggestedFix: 'Add explicit width and height attributes to prevent CLS',
      estimatedImpact: 3,
      estimatedEffort: 'M',
    });
  }

  return findings;
}
