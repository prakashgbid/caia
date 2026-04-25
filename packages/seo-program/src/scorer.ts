import type { Finding, DimensionKey, DimensionScore, AuditResult } from './types.js';

const DIMENSION_CONFIG: Record<DimensionKey, { label: string; weight: number; threshold: Record<string, number> }> = {
  'technical': { label: 'Technical SEO', weight: 0.25, threshold: { critical: 15, major: 8, minor: 3, info: 0 } },
  'on-page':   { label: 'On-Page SEO',   weight: 0.25, threshold: { critical: 15, major: 8, minor: 3, info: 0 } },
  'content':   { label: 'Content',       weight: 0.20, threshold: { critical: 20, major: 10, minor: 4, info: 0 } },
  'performance': { label: 'Performance', weight: 0.15, threshold: { critical: 20, major: 10, minor: 3, info: 0 } },
  'social':    { label: 'Social / OG',   weight: 0.10, threshold: { critical: 15, major: 8, minor: 2, info: 0 } },
  'security':  { label: 'Security',      weight: 0.05, threshold: { critical: 20, major: 10, minor: 3, info: 0 } },
};

function dimensionScore(findings: Finding[]): number {
  let penalty = 0;
  for (const f of findings) {
    const sev = f.severity;
    if (sev === 'critical') penalty += 25;
    else if (sev === 'major') penalty += 10;
    else if (sev === 'minor') penalty += 4;
    else penalty += 1;
  }
  return Math.max(0, 100 - penalty);
}

function grade(score: number): string {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

export function buildResult(
  url: string,
  timestamp: string,
  ttfb: number,
  statusCode: number,
  allFindings: Finding[],
): AuditResult {
  const dimensions: DimensionScore[] = (Object.keys(DIMENSION_CONFIG) as DimensionKey[]).map(key => {
    const cfg = DIMENSION_CONFIG[key];
    const dimFindings = allFindings.filter(f => f.dimension === key);
    return {
      key,
      label: cfg.label,
      score: dimensionScore(dimFindings),
      weight: cfg.weight,
      findings: dimFindings,
    };
  });

  const composite = Math.round(
    dimensions.reduce((sum, d) => sum + d.score * d.weight, 0)
  );

  return {
    url,
    timestamp,
    ttfb,
    statusCode,
    composite,
    grade: grade(composite),
    dimensions,
    findings: allFindings,
  };
}
