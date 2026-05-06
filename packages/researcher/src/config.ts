/**
 * ResearcherAgentConfig — parameterised constructor input.
 *
 * Per `agent_architecture_shape_2026-05-06.md` (Option E), every CAIA-specific
 * path / topic / registry / integration is a constructor parameter with a CAIA
 * default. Tests inject fixture corpora; production injects CAIA defaults.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  Depth,
  LlmClient,
  PrecedentSource,
  WebFetcher,
  WebSearcher
} from './types.js';

export interface ResearcherAgentConfig {
  /* CAIA-bonded paths (override per project). */
  reportsRoot?: string;
  memoryDir?: string;
  librarianDbPath?: string;

  /* LLM subprocess. */
  claudeBinaryPath?: string;
  /** Model used for the synthesis stage. */
  synthesisModel?: string;
  /** Model used for the planner stage (cheaper / faster). */
  plannerModel?: string;

  /* Behaviour knobs. */
  defaultDepth?: Depth;
  shallowSubQuestions?: number;
  mediumSubQuestions?: number;
  deepSubQuestions?: number;
  shallowSourcesPerQuestion?: number;
  mediumSourcesPerQuestion?: number;
  deepSourcesPerQuestion?: number;
  perFetchTimeoutMs?: number;
  synthesisTimeoutMs?: number;
  plannerTimeoutMs?: number;
  /** Copyright guard: max consecutive verbatim words allowed. */
  maxQuoteWords?: number;
  /** Refuse to publish reports below this floor. */
  minSourceCount?: number;
  /** If hallucination ratio exceeds this, regenerate once. */
  hallucinationRatioThreshold?: number;

  /* Test seams (DI). */
  searcher?: WebSearcher;
  fetcher?: WebFetcher;
  precedentSource?: PrecedentSource;
  llm?: LlmClient;
  clock?: () => Date;
}

export interface ResolvedResearcherConfig {
  reportsRoot: string;
  memoryDir: string;
  librarianDbPath: string;
  claudeBinaryPath: string;
  synthesisModel: string;
  plannerModel: string;
  defaultDepth: Depth;
  shallowSubQuestions: number;
  mediumSubQuestions: number;
  deepSubQuestions: number;
  shallowSourcesPerQuestion: number;
  mediumSourcesPerQuestion: number;
  deepSourcesPerQuestion: number;
  perFetchTimeoutMs: number;
  synthesisTimeoutMs: number;
  plannerTimeoutMs: number;
  maxQuoteWords: number;
  minSourceCount: number;
  hallucinationRatioThreshold: number;
  searcher: WebSearcher | null;
  fetcher: WebFetcher | null;
  precedentSource: PrecedentSource | null;
  llm: LlmClient | null;
  clock: () => Date;
}

const HOME = homedir();

/** CAIA default paths — used when constructor parameters are omitted. */
export const CAIA_DEFAULT_REPORTS_ROOT = join(HOME, 'Documents/projects/reports');
export const CAIA_DEFAULT_MEMORY_DIR = join(
  HOME,
  'Documents/projects/caia/agent/memory'
);
export const CAIA_DEFAULT_LIBRARIAN_DB_PATH = join(
  HOME,
  'Library/Application Support/caia/librarian/index.sqlite'
);

export function resolveConfig(
  raw: ResearcherAgentConfig | undefined
): ResolvedResearcherConfig {
  const r = raw ?? {};
  return {
    reportsRoot: r.reportsRoot ?? CAIA_DEFAULT_REPORTS_ROOT,
    memoryDir: r.memoryDir ?? CAIA_DEFAULT_MEMORY_DIR,
    librarianDbPath: r.librarianDbPath ?? CAIA_DEFAULT_LIBRARIAN_DB_PATH,
    claudeBinaryPath: r.claudeBinaryPath ?? 'claude',
    synthesisModel: r.synthesisModel ?? 'claude-sonnet-4-6',
    plannerModel: r.plannerModel ?? 'claude-haiku-4-5-20251001',
    defaultDepth: r.defaultDepth ?? 'medium',
    shallowSubQuestions: r.shallowSubQuestions ?? 3,
    mediumSubQuestions: r.mediumSubQuestions ?? 5,
    deepSubQuestions: r.deepSubQuestions ?? 8,
    shallowSourcesPerQuestion: r.shallowSourcesPerQuestion ?? 5,
    mediumSourcesPerQuestion: r.mediumSourcesPerQuestion ?? 8,
    deepSourcesPerQuestion: r.deepSourcesPerQuestion ?? 12,
    perFetchTimeoutMs: r.perFetchTimeoutMs ?? 30_000,
    synthesisTimeoutMs: r.synthesisTimeoutMs ?? 300_000,
    plannerTimeoutMs: r.plannerTimeoutMs ?? 60_000,
    maxQuoteWords: r.maxQuoteWords ?? 14,
    minSourceCount: r.minSourceCount ?? 10,
    hallucinationRatioThreshold: r.hallucinationRatioThreshold ?? 0.2,
    searcher: r.searcher ?? null,
    fetcher: r.fetcher ?? null,
    precedentSource: r.precedentSource ?? null,
    llm: r.llm ?? null,
    clock: r.clock ?? ((): Date => new Date())
  };
}

/** Returns sub-question target for a depth tier. */
export function subQuestionsForDepth(
  depth: Depth,
  cfg: ResolvedResearcherConfig
): number {
  switch (depth) {
    case 'shallow':
      return cfg.shallowSubQuestions;
    case 'medium':
      return cfg.mediumSubQuestions;
    case 'deep':
      return cfg.deepSubQuestions;
  }
}

/** Returns sources-per-sub-question target for a depth tier. */
export function sourcesPerQuestionForDepth(
  depth: Depth,
  cfg: ResolvedResearcherConfig
): number {
  switch (depth) {
    case 'shallow':
      return cfg.shallowSourcesPerQuestion;
    case 'medium':
      return cfg.mediumSourcesPerQuestion;
    case 'deep':
      return cfg.deepSourcesPerQuestion;
  }
}
