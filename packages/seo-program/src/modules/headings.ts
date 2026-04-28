import type { CheerioAPI } from 'cheerio';
import type { Finding } from '../types.js';

export function auditHeadings(url: string, $: CheerioAPI): Finding[] {
  const findings: Finding[] = [];

  const h1s = $('h1').map((_, el) => $(el).text().trim()).get();

  if (h1s.length === 0) {
    findings.push({ id: 'h1-missing', dimension: 'on-page', severity: 'critical', url, message: 'No H1 found on page', suggestedFix: 'Add exactly one H1 tag with the primary keyword', estimatedImpact: 8, estimatedEffort: 'S' });
  } else if (h1s.length > 1) {
    findings.push({ id: 'h1-multiple', dimension: 'on-page', severity: 'major', url, message: `${h1s.length} H1 tags found (should be exactly 1)`, evidence: h1s, suggestedFix: 'Keep one H1 per page; demote extras to H2', estimatedImpact: 4, estimatedEffort: 'S' });
  }

  // Check hierarchy — collect all heading levels in order
  const levels: number[] = [];
  $('h1,h2,h3,h4,h5,h6').each((_, el) => {
    levels.push(parseInt(el.tagName.slice(1), 10));
  });

  let prevLevel = 0;
  let skips = 0;
  for (const level of levels) {
    if (prevLevel > 0 && level > prevLevel + 1) skips++;
    prevLevel = level;
  }

  if (skips > 0) {
    findings.push({ id: 'heading-hierarchy-skip', dimension: 'on-page', severity: 'minor', url, message: `Heading hierarchy skips ${skips} level(s) (e.g., H1→H3)`, suggestedFix: 'Use sequential heading levels (H1→H2→H3) without gaps', estimatedImpact: 2, estimatedEffort: 'M' });
  }

  // Empty headings
  const emptyHeadings = $('h1,h2,h3,h4,h5,h6').filter((_, el) => !$(el).text().trim()).length;
  if (emptyHeadings > 0) {
    findings.push({ id: 'heading-empty', dimension: 'on-page', severity: 'major', url, message: `${emptyHeadings} empty heading tag(s) found`, suggestedFix: 'Remove empty headings or add meaningful text', estimatedImpact: 3, estimatedEffort: 'S' });
  }

  return findings;
}
