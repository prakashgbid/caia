/**
 * Searcher — given a Source, returns SearchResult[] of items published
 * since `sinceIso`. The production WebSearcher adapter is injected at
 * construction time; the default exported here is a NullWebSearcher that
 * returns no items (safe fallback for environments without WebSearch).
 */
import type { Source, SearchResult, WebSearcher } from './types.js';

/**
 * Null searcher — returns no items. Useful as a safe default when no
 * WebSearch tool is wired up; the cron logs an empty scan rather than
 * throwing.
 */
export class NullWebSearcher implements WebSearcher {
  async search(_source: Source, _sinceIso: string): Promise<SearchResult[]> {
    return [];
  }
}

/**
 * In-memory canned searcher for tests. Returns a fixed set of items per
 * sourceId from a seed map. Items not associated with a known source are
 * silently dropped.
 */
export class CannedWebSearcher implements WebSearcher {
  constructor(private readonly seed: Record<string, SearchResult[]>) {}

  async search(source: Source, _sinceIso: string): Promise<SearchResult[]> {
    return this.seed[source.id] ?? [];
  }
}

/**
 * Iterate a list of sources, collect their last-24h results, and return
 * a flat list of SearchResult. Errors per source are captured into the
 * `errors` output array — one bad source does not abort the scan.
 */
export interface ScanSourcesInput {
  sources: Source[];
  searcher: WebSearcher;
  sinceIso: string;
}

export interface ScanSourcesResult {
  results: SearchResult[];
  errors: Array<{ sourceId: string; message: string }>;
}

export async function scanSources(input: ScanSourcesInput): Promise<ScanSourcesResult> {
  const results: SearchResult[] = [];
  const errors: Array<{ sourceId: string; message: string }> = [];
  for (const source of input.sources) {
    try {
      const items = await input.searcher.search(source, input.sinceIso);
      for (const item of items) {
        results.push({ ...item, sourceId: source.id });
      }
    } catch (err) {
      errors.push({ sourceId: source.id, message: err instanceof Error ? err.message : String(err) });
    }
  }
  return { results, errors };
}

/** Load the curated source list from a JSON file. */
export function loadSourceList(filePath: string, fs: { exists(p: string): boolean; readFile(p: string): string }): Source[] {
  if (!fs.exists(filePath)) return [];
  const raw = fs.readFile(filePath);
  const parsed = JSON.parse(raw) as { sources?: unknown };
  if (!parsed.sources || !Array.isArray(parsed.sources)) return [];
  return parsed.sources.filter(isSource);
}

function isSource(x: unknown): x is Source {
  return typeof x === 'object' && x !== null && typeof (x as Source).id === 'string' && typeof (x as Source).url === 'string';
}
