import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { LooseBacklogItem } from './types.js';

const pExecFile = promisify(execFile);

export interface GatheredContext {
  /** Inline file snippets for the LLM (truncated to keep prompt size small). */
  files: Array<{ path: string; snippet: string; truncated: boolean }>;
  /** Lines from grep against the backlog item's title/id keywords. */
  grep_hits: Array<{ pattern: string; lines: string[] }>;
  /** Optional semantic-search results from local-llm-router (:7411). */
  semantic_hits: Array<{ path: string; score?: number; snippet?: string }>;
  /** Soft summary of what was tried — written into the LLM prompt as breadcrumbs. */
  summary: string;
}

export interface GatherOptions {
  /** Repo root for grep + readFile resolution. Defaults to CWD. */
  cwd?: string;
  /** Explicit files to include verbatim (caller-provided via --context-files). */
  contextFiles?: string[];
  /** Max bytes per file snippet (truncate beyond). */
  maxFileBytes?: number;
  /** Total cap on context payload (rough char budget). */
  maxTotalBytes?: number;
  /** Base URL for local-llm-router semantic-search. Null disables. */
  routerBaseUrl?: string | null;
  /** Override the default grep impl (for tests). */
  grepImpl?: (pattern: string, cwd: string) => Promise<string[]>;
  /** Override the default file reader (for tests). */
  readFileImpl?: (path: string) => Promise<string>;
  /** Override the default semantic-search impl (for tests). */
  semanticSearchImpl?: (
    query: string,
    routerBaseUrl: string,
  ) => Promise<Array<{ path: string; score?: number; snippet?: string }>>;
}

const DEFAULT_MAX_FILE_BYTES = 4000;
const DEFAULT_MAX_TOTAL_BYTES = 16_000;
const DEFAULT_ROUTER_BASE_URL = 'http://127.0.0.1:7411';

/**
 * Gather codebase context for a backlog item:
 *   1. read explicit context files (--context-files), truncated.
 *   2. read file_paths from the item (if any), truncated.
 *   3. grep the repo for keywords derived from id/title.
 *   4. optionally hit local-llm-router :7411 for semantic results.
 *
 * Each step is best-effort: failures are caught and recorded into `summary`
 * rather than thrown, because the LLM scaffolder can still produce a useful
 * chain from partial context.
 */
export async function gatherContext(
  item: LooseBacklogItem,
  opts: GatherOptions = {},
): Promise<GatheredContext> {
  const cwd = opts.cwd ?? process.cwd();
  const maxFileBytes = opts.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = opts.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const routerBaseUrl = opts.routerBaseUrl === null
    ? null
    : (opts.routerBaseUrl ?? DEFAULT_ROUTER_BASE_URL);
  const readImpl = opts.readFileImpl ?? ((p: string) => readFile(p, 'utf8'));
  const grepImpl = opts.grepImpl ?? defaultGrep;
  const semanticImpl = opts.semanticSearchImpl ?? defaultSemanticSearch;

  const breadcrumbs: string[] = [];
  let bytesUsed = 0;
  const files: GatheredContext['files'] = [];
  const grep_hits: GatheredContext['grep_hits'] = [];
  const semantic_hits: GatheredContext['semantic_hits'] = [];

  const addFile = async (rawPath: string, source: string) => {
    if (bytesUsed >= maxTotalBytes) return;
    const path = isAbsolute(rawPath) ? rawPath : resolve(cwd, rawPath);
    try {
      const s = await stat(path);
      if (!s.isFile()) {
        breadcrumbs.push(`skip ${source} ${rawPath}: not a regular file`);
        return;
      }
    } catch (e) {
      breadcrumbs.push(`skip ${source} ${rawPath}: ${(e as Error).message}`);
      return;
    }
    try {
      const content = await readImpl(path);
      const cap = Math.min(maxFileBytes, Math.max(0, maxTotalBytes - bytesUsed));
      const truncated = content.length > cap;
      const snippet = truncated ? content.slice(0, cap) : content;
      files.push({ path: rawPath, snippet, truncated });
      bytesUsed += snippet.length;
    } catch (e) {
      breadcrumbs.push(`read failed ${rawPath}: ${(e as Error).message}`);
    }
  };

  for (const cf of opts.contextFiles ?? []) {
    await addFile(cf, 'context-file');
  }
  for (const fp of item.file_paths ?? []) {
    await addFile(fp, 'item-file_paths');
  }

  // ── grep step ──────────────────────────────────────────────────────
  const keywords = deriveKeywords(item);
  for (const kw of keywords) {
    if (bytesUsed >= maxTotalBytes) break;
    try {
      const lines = await grepImpl(kw, cwd);
      const trimmed = lines.slice(0, 12);
      if (trimmed.length > 0) {
        grep_hits.push({ pattern: kw, lines: trimmed });
        bytesUsed += trimmed.join('\n').length;
      }
    } catch (e) {
      breadcrumbs.push(`grep '${kw}' failed: ${(e as Error).message}`);
    }
  }

  // ── semantic search step ────────────────────────────────────────────
  if (routerBaseUrl && bytesUsed < maxTotalBytes) {
    try {
      const query = `${item.title}. ${item.description}`.slice(0, 600);
      const hits = await semanticImpl(query, routerBaseUrl);
      const trimmed = hits.slice(0, 5);
      semantic_hits.push(...trimmed);
      bytesUsed += JSON.stringify(trimmed).length;
      breadcrumbs.push(`semantic-search: ${trimmed.length} hit(s) from ${routerBaseUrl}`);
    } catch (e) {
      breadcrumbs.push(`semantic-search at ${routerBaseUrl} failed (continuing without): ${(e as Error).message}`);
    }
  } else if (!routerBaseUrl) {
    breadcrumbs.push('semantic-search: disabled (routerBaseUrl=null)');
  }

  const summary =
    `Gathered ${files.length} file snippet(s), ${grep_hits.length} grep hit-set(s), ` +
    `${semantic_hits.length} semantic hit(s). Budget used ~${bytesUsed}/${maxTotalBytes} bytes. ` +
    (breadcrumbs.length > 0 ? `Notes: ${breadcrumbs.join(' | ')}` : '');

  return { files, grep_hits, semantic_hits, summary };
}

/** Derive grep keywords from a backlog item: id segments + capitalised title words. */
export function deriveKeywords(item: LooseBacklogItem): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t.length < 3) return;
    if (seen.has(t.toLowerCase())) return;
    seen.add(t.toLowerCase());
    out.push(t);
  };
  // id segments split on - and _
  for (const seg of item.id.split(/[-_]/)) push(seg);
  // title words 4+ chars
  for (const w of item.title.split(/[\s,./()[\]]+/)) {
    if (w.length >= 4) push(w);
  }
  // explicit file_paths basenames
  for (const fp of item.file_paths ?? []) {
    const base = fp.split('/').pop() ?? '';
    push(base.replace(/\.\w+$/, ''));
  }
  return out.slice(0, 6);
}

async function defaultGrep(pattern: string, cwd: string): Promise<string[]> {
  // Use git grep when inside a repo (fast + respects .gitignore); fall back to
  // plain grep otherwise. Both are tolerant of zero matches (rc=1).
  try {
    const { stdout } = await pExecFile('git', ['grep', '-n', '-I', '--max-count', '4', pattern], {
      cwd,
      maxBuffer: 1_000_000,
    });
    return stdout.split('\n').filter((l) => l.length > 0).slice(0, 20);
  } catch (e: unknown) {
    const err = e as { code?: number; stdout?: string };
    // rc=1 = no matches, normal — return empty
    if (err.code === 1) return [];
    // Outside a repo? Fall through to bare grep.
    try {
      const { stdout } = await pExecFile('grep', ['-rn', '--max-count=4', '--include=*.ts', '--include=*.md', pattern, '.'], {
        cwd,
        maxBuffer: 1_000_000,
      });
      return stdout.split('\n').filter((l) => l.length > 0).slice(0, 20);
    } catch (e2: unknown) {
      const err2 = e2 as { code?: number };
      if (err2.code === 1) return [];
      throw e2;
    }
  }
}

async function defaultSemanticSearch(
  query: string,
  routerBaseUrl: string,
): Promise<Array<{ path: string; score?: number; snippet?: string }>> {
  const url = `${routerBaseUrl.replace(/\/$/, '')}/v1/search-memory`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, top_k: 5 }),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      // The endpoint is broken in some local-llm-router builds (see CAIA memory:
      // librarian exports gap). Treat any non-2xx as "no hits" silently so the
      // scaffolder remains usable even when the router has a partial outage.
      return [];
    }
    const data = (await res.json()) as { hits?: unknown[]; results?: unknown[] };
    const rawHits = Array.isArray(data.hits) ? data.hits : Array.isArray(data.results) ? data.results : [];
    const out: Array<{ path: string; score?: number; snippet?: string }> = [];
    for (const h of rawHits) {
      if (!h || typeof h !== 'object') continue;
      const obj = h as Record<string, unknown>;
      const path = (obj.path ?? obj.file ?? obj.source) as string | undefined;
      if (!path) continue;
      const hit: { path: string; score?: number; snippet?: string } = { path };
      if (typeof obj.score === 'number') hit.score = obj.score;
      if (typeof obj.snippet === 'string') hit.snippet = obj.snippet;
      else if (typeof obj.text === 'string') hit.snippet = obj.text;
      out.push(hit);
    }
    return out;
  } finally {
    clearTimeout(t);
  }
}
