/**
 * @caia/memory-consolidator public types. Layer 4. Option-E shape.
 */

export interface FsAdapter {
  exists(path: string): boolean;
  readFile(path: string): string;
  writeFile(path: string, content: string): void;
  appendFile(path: string, content: string): void;
  readDir(path: string): string[];
  statMtimeMs(path: string): number;
  isDir(path: string): boolean;
  mkdirp(path: string): void;
}

export interface MemoryFile {
  absPath: string;
  relPath: string;
  frontmatter: Record<string, unknown> | null;
  body: string;
  mtimeMs: number;
  wikiLinks: string[];
  mdLinks: ReadonlyArray<{ text: string; target: string }>;
  supersededBy: string | null;
}

export interface ScanResult {
  files: MemoryFile[];
  indexedRelPaths: ReadonlySet<string>;
  indexFileRelPath: string;
}

export interface Finding {
  kind: 'broken-wikilink' | 'broken-mdlink' | 'stale-supersedes' | 'missing-index-entry';
  sourceRelPath: string;
  detail: string;
  severity: 'warn' | 'error';
}

export interface ConsolidatorConfig {
  corpusRoot?: string;
  researchRoot?: string;
  inboxPath?: string;
  reportsRoot?: string;
  clock?: () => Date;
  fs?: FsAdapter;
  dedupeWindowDays?: number;
  indexFileName?: string;
  dryRun?: boolean;
}

export interface ConsolidationReport {
  runAt: string;
  filesScanned: number;
  findings: Finding[];
  newInboxEntries: number;
  reportPath: string | null;
  dryRun: boolean;
}
