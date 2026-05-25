/**
 * @caia/ai-first-upgrade-scanner public types. Layer 6. Option-E shape.
 */

export interface FsAdapter {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  appendFile(path: string, content: string): void;
  readDir(path: string): string[];
  mkdirp(path: string): void;
}

export interface Source {
  id: string;
  name: string;
  url: string;
  keywords: string[];
  category: 'vendor-blog' | 'research' | 'community';
}

export interface SourceList {
  schema_version: number;
  sources: Source[];
}

export interface SearchResult {
  sourceId: string;
  title: string;
  url: string;
  publishedAt: string | null;
  excerpt: string;
}

export interface RelevanceVerdict {
  relevant: boolean;
  confidence: number;
  reason: string;
  recommendation: string;
}

export interface JudgedItem {
  item: SearchResult;
  verdict: RelevanceVerdict;
}

export interface CandidateAdr {
  slug: string;
  filePath: string;
  content: string;
}

export interface WebSearcher {
  search(source: Source, sinceIso: string): Promise<SearchResult[]>;
}

export interface RelevanceCritic {
  judge(item: SearchResult): Promise<RelevanceVerdict>;
}

export interface ScannerConfig {
  sourcesPath?: string;
  decisionsRoot?: string;
  inboxPath?: string;
  reportsRoot?: string;
  webSearcher?: WebSearcher;
  relevanceCritic?: RelevanceCritic;
  clock?: () => Date;
  fs?: FsAdapter;
  confidenceThreshold?: number;
  inboxDailyCap?: number;
  lookbackHours?: number;
}

export interface ScanReport {
  runAt: string;
  sourcesScanned: number;
  itemsFound: number;
  itemsJudged: number;
  itemsRelevant: number;
  candidateAdrs: CandidateAdr[];
  inboxEntries: number;
  reportPath: string | null;
  errors: ScanError[];
  dryRun: boolean;
}

export interface ScanError {
  sourceId?: string;
  itemUrl?: string;
  kind: 'search-error' | 'judge-error' | 'draft-error';
  message: string;
}
