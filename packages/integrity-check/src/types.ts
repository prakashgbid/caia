export type Severity = 'error' | 'warning';

export type RuleId =
  | 'dead-onclick'
  | 'button-without-action'
  | 'missing-href'
  | 'unresolved-import'
  | 'unknown-handler'
  | 'broken-route'
  | 'broken-external'
  | 'http-error';

export interface Issue {
  rule: RuleId;
  severity: Severity;
  file: string;
  line: number;
  col: number;
  message: string;
  /** Suggested auto-fix description */
  fix?: string;
  /** Whether this issue was auto-fixed in --fix mode */
  fixed?: boolean;
}

export interface StaticResult {
  filesScanned: number;
  issues: Issue[];
}

export interface CrawlResult {
  routesChecked: number;
  issues: Issue[];
}

export interface ScanOptions {
  staticOnly?: boolean;
  crawlOnly?: boolean;
  runtimeOnly?: boolean;
  fix?: boolean;
  /** Base URL for crawl layer (e.g. http://localhost:3000) */
  baseUrl?: string;
}

export interface ScanResult {
  projectDir: string;
  timestamp: string;
  issues: Issue[];
  stats: {
    filesScanned: number;
    routesChecked: number;
    issuesFound: number;
    errors: number;
    warnings: number;
    fixed: number;
  };
}
