import type { CheerioAPI } from 'cheerio';
import type { Finding } from '../types.js';

export function auditSocial(url: string, $: CheerioAPI): Finding[] {
  const findings: Finding[] = [];

  // Open Graph
  const ogTitle = $('meta[property="og:title"]').attr('content')?.trim();
  const ogDesc = $('meta[property="og:description"]').attr('content')?.trim();
  const ogImage = $('meta[property="og:image"]').attr('content')?.trim();
  const ogType = $('meta[property="og:type"]').attr('content')?.trim();
  const ogUrl = $('meta[property="og:url"]').attr('content')?.trim();

  if (!ogTitle) findings.push({ id: 'og-title-missing', dimension: 'social', severity: 'major', url, message: 'Missing og:title', suggestedFix: 'Add <meta property="og:title"> for social sharing', estimatedImpact: 4, estimatedEffort: 'S' });
  if (!ogDesc) findings.push({ id: 'og-description-missing', dimension: 'social', severity: 'major', url, message: 'Missing og:description', suggestedFix: 'Add <meta property="og:description">', estimatedImpact: 3, estimatedEffort: 'S' });
  if (!ogImage) findings.push({ id: 'og-image-missing', dimension: 'social', severity: 'major', url, message: 'Missing og:image — links shared on social will have no preview image', suggestedFix: 'Add og:image (1200×630px) for rich social sharing previews', estimatedImpact: 5, estimatedEffort: 'M' });
  if (!ogType) findings.push({ id: 'og-type-missing', dimension: 'social', severity: 'minor', url, message: 'Missing og:type', suggestedFix: 'Add <meta property="og:type" content="website">', estimatedImpact: 1, estimatedEffort: 'S' });
  if (!ogUrl) findings.push({ id: 'og-url-missing', dimension: 'social', severity: 'minor', url, message: 'Missing og:url', suggestedFix: 'Add <meta property="og:url" content="…page URL…">', estimatedImpact: 1, estimatedEffort: 'S' });

  // Twitter Cards
  const twitterCard = $('meta[name="twitter:card"]').attr('content')?.trim();
  const twitterTitle = $('meta[name="twitter:title"]').attr('content')?.trim();
  const twitterDesc = $('meta[name="twitter:description"]').attr('content')?.trim();

  if (!twitterCard) {
    findings.push({ id: 'twitter-card-missing', dimension: 'social', severity: 'major', url, message: 'Missing twitter:card meta tag', suggestedFix: 'Add <meta name="twitter:card" content="summary_large_image">', estimatedImpact: 4, estimatedEffort: 'S' });
  }
  if (!twitterTitle) {
    findings.push({ id: 'twitter-title-missing', dimension: 'social', severity: 'minor', url, message: 'Missing twitter:title', suggestedFix: 'Add <meta name="twitter:title">', estimatedImpact: 1, estimatedEffort: 'S' });
  }
  if (!twitterDesc) {
    findings.push({ id: 'twitter-desc-missing', dimension: 'social', severity: 'minor', url, message: 'Missing twitter:description', suggestedFix: 'Add <meta name="twitter:description">', estimatedImpact: 1, estimatedEffort: 'S' });
  }

  return findings;
}
