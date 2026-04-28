export type Severity = 'critical' | 'major' | 'minor' | 'info';
export type Effort = 'S' | 'M' | 'L';
export type DimensionKey = 'technical' | 'on-page' | 'content' | 'performance' | 'social' | 'security';

export interface Finding {
  id: string;
  dimension: DimensionKey;
  severity: Severity;
  url?: string;
  message: string;
  evidence?: unknown;
  suggestedFix: string;
  estimatedImpact: number; // 0-10
  estimatedEffort: Effort;
}

export interface DimensionScore {
  key: DimensionKey;
  label: string;
  score: number; // 0-100
  weight: number;
  findings: Finding[];
}

export interface AuditResult {
  url: string;
  timestamp: string;
  ttfb: number;
  statusCode: number;
  composite: number;
  grade: string;
  dimensions: DimensionScore[];
  findings: Finding[];
}

export interface DeltaReport {
  url: string;
  before: AuditResult;
  after: AuditResult;
  delta: number;
  improved: Finding[];
  regressed: Finding[];
  unchanged: Finding[];
}
