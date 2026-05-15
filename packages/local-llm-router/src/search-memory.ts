// A.9.12 — Backing implementation for /v1/search-memory.
//
// Powers the local_search_memory MCP tool. Migrates the
// librarian/mentor prepend-CLI shims away from spawning per call: the
// MCP tool now hits this endpoint, and the endpoint reuses the same
// retrievePrecedent / retrieveLessons libraries in-process.
//
// Embedding model: nomic-embed-text via the configured ollamaBaseUrl
// (default http://127.0.0.1:11434). Same as the index-build path so
// query/row dimensionality match.
//
// The memory dir defaults to $CAIA_MEMORY_DIR (set by the operator
// LaunchAgent) and falls back to ~/Documents/projects/caia/agent/memory
// — the canonical location per packages/librarian/src/prepend-cli.ts.

import { homedir } from 'node:os';
import { join } from 'node:path';

import {
  createOllamaEmbedder,
  retrievePrecedent,
  type RetrievedPrecedent,
} from '@chiefaia/librarian';
import {
  retrieveLessons,
  type RetrievedLesson,
} from '@chiefaia/mentor-retrieval';

export type SearchMemorySource = 'librarian' | 'mentor' | 'both';

export interface SearchMemoryRequest {
  query: string;
  k: number;
  source: SearchMemorySource;
  ollamaBaseUrl: string;
  memoryDir?: string;
}

export interface SearchMemoryHit {
  kind: string;
  slug: string;
  path: string;
  similarity: number;
  snippet: string;
  origin: 'librarian' | 'mentor';
}

export interface SearchMemoryResponse {
  query: string;
  k: number;
  source: SearchMemorySource;
  hits: SearchMemoryHit[];
  /** Per-origin warnings (e.g., index missing). Empty when both succeeded. */
  warnings: string[];
  /** Tally of what each origin returned BEFORE the merge to top-k. */
  origin_counts: { librarian: number; mentor: number };
}

const DEFAULT_K = 5;
const DEFAULT_MEMORY_DIR = join(
  homedir(),
  'Documents',
  'projects',
  'caia',
  'agent',
  'memory',
);

export async function searchMemoryHandler(
  req: SearchMemoryRequest,
): Promise<SearchMemoryResponse> {
  const k = req.k > 0 ? req.k : DEFAULT_K;
  const memoryDir =
    req.memoryDir ?? process.env['CAIA_MEMORY_DIR'] ?? DEFAULT_MEMORY_DIR;
  const embed = createOllamaEmbedder({
    url: req.ollamaBaseUrl,
    model: 'nomic-embed-text',
  });

  const warnings: string[] = [];
  const collect: SearchMemoryHit[] = [];
  let librarianCount = 0;
  let mentorCount = 0;

  if (req.source === 'librarian' || req.source === 'both') {
    try {
      const lib: RetrievedPrecedent[] = await retrievePrecedent(req.query, {
        memoryDir,
        embed,
        topN: k,
        warn: (m: string) => warnings.push(`librarian: ${m}`),
      });
      librarianCount = lib.length;
      for (const p of lib) {
        collect.push({
          kind: p.kind,
          slug: p.slug,
          path: p.path,
          similarity: p.similarity,
          snippet: truncate(p.snippet, 800),
          origin: 'librarian',
        });
      }
    } catch (e) {
      warnings.push(`librarian: ${describe(e)}`);
    }
  }

  if (req.source === 'mentor' || req.source === 'both') {
    try {
      const ment: RetrievedLesson[] = await retrieveLessons(req.query, {
        memoryDir,
        embed,
        topN: k,
        warn: (m: string) => warnings.push(`mentor: ${m}`),
      });
      mentorCount = ment.length;
      for (const m of ment) {
        collect.push({
          kind: m.kind,
          slug: m.slug,
          path: m.path,
          similarity: m.similarity,
          snippet: truncate(m.snippet, 800),
          origin: 'mentor',
        });
      }
    } catch (e) {
      warnings.push(`mentor: ${describe(e)}`);
    }
  }

  collect.sort((a, b) => b.similarity - a.similarity);
  const top = collect.slice(0, k);

  return {
    query: req.query,
    k,
    source: req.source,
    hits: top,
    warnings,
    origin_counts: { librarian: librarianCount, mentor: mentorCount },
  };
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max) + '…';
}

function describe(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
