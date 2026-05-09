/**
 * @chiefaia/surface — config resolution.
 *
 * Constructor injects every CAIA-specific path / repo / threshold; defaults
 * resolve from env vars, then from compile-time CAIA defaults. Tests inject
 * fixture paths and bypass env entirely.
 *
 * Per Option E (agent_architecture_shape_2026-05-06.md), all CAIA-specific
 * literals are constructor parameters with defaults. Tests verify the shape
 * holds under fixture corpora.
 */

import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

import type { FsReader, GhRunner, GitRunner } from './types.js';

export interface SurfaceAgentConfig {
  /** Memory file root. Defaults to ~/Documents/projects/agent-memory. */
  corpusRoot?: string;
  /** GitHub repo for PR connector. Defaults to prakashgbid/caia. */
  ghRepo?: string;
  /** Local clone of the repo for memory git-log; defaults to corpusRoot's
   *  parent (`~/Documents/projects`) when corpusRoot lives inside a git repo,
   *  otherwise corpusRoot itself. */
  memoryGitRepo?: string;
  /** Transcript root. Defaults to local-agent-mode-sessions. */
  transcriptRoot?: string;
  /** Reports dir for default --output. Defaults to ~/Documents/projects/reports. */
  reportsRoot?: string;
  /** Hard digest size cap in bytes. Defaults to 50_000. */
  maxBytes?: number;
  /** Importance floor (0..1). Defaults to 0.35. */
  minImportance?: number;
  /** Max findings per digest after filtering. Defaults to 100. */
  maxFindings?: number;
  /** DI seams — tests inject fakes. */
  fs?: FsReader;
  gh?: GhRunner;
  git?: GitRunner;
  clock?: () => Date;
}

export interface ResolvedSurfaceAgentConfig {
  corpusRoot: string;
  ghRepo: string;
  memoryGitRepo: string;
  transcriptRoot: string;
  reportsRoot: string;
  maxBytes: number;
  minImportance: number;
  maxFindings: number;
}

/**
 * Expand a leading `~/` to the operator's home dir. Anything else is
 * returned untouched.
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

const DEFAULT_CORPUS_ROOT = '~/Documents/projects/agent-memory';
const DEFAULT_GH_REPO = 'prakashgbid/caia';
const DEFAULT_MEMORY_GIT_REPO = '~/Documents/projects/agent-memory';
const DEFAULT_TRANSCRIPT_ROOT = '~/Library/Application Support/Claude/local-agent-mode-sessions';
const DEFAULT_REPORTS_ROOT = '~/Documents/projects/reports';
const DEFAULT_MAX_BYTES = 50_000;
const DEFAULT_MIN_IMPORTANCE = 0.35;
const DEFAULT_MAX_FINDINGS = 100;

export function resolveConfig(input: SurfaceAgentConfig = {}): ResolvedSurfaceAgentConfig {
  const corpusRoot = expandHome(
    input.corpusRoot
    ?? process.env['CAIA_MEMORY_ROOT']
    ?? DEFAULT_CORPUS_ROOT
  );
  const ghRepo =
    input.ghRepo
    ?? process.env['SURFACE_GH_REPO']
    ?? DEFAULT_GH_REPO;
  const memoryGitRepo = expandHome(
    input.memoryGitRepo
    ?? process.env['SURFACE_MEMORY_GIT_REPO']
    ?? DEFAULT_MEMORY_GIT_REPO
  );
  const transcriptRoot = expandHome(
    input.transcriptRoot
    ?? process.env['SURFACE_TRANSCRIPT_ROOT']
    ?? DEFAULT_TRANSCRIPT_ROOT
  );
  const reportsRoot = expandHome(
    input.reportsRoot
    ?? process.env['CAIA_REPORTS_ROOT']
    ?? DEFAULT_REPORTS_ROOT
  );
  const maxBytes =
    input.maxBytes
    ?? (Number(process.env['SURFACE_MAX_BYTES']) || DEFAULT_MAX_BYTES);
  const minImportance =
    input.minImportance
    ?? (Number(process.env['SURFACE_MIN_IMPORTANCE']) || DEFAULT_MIN_IMPORTANCE);
  const maxFindings =
    input.maxFindings
    ?? (Number(process.env['SURFACE_MAX_FINDINGS']) || DEFAULT_MAX_FINDINGS);

  return {
    corpusRoot,
    ghRepo,
    memoryGitRepo,
    transcriptRoot,
    reportsRoot,
    maxBytes,
    minImportance,
    maxFindings
  };
}

/** Convenience: build a default repo path from corpusRoot if user didn't override. */
export function inferMemoryGitRepo(corpusRoot: string): string {
  // corpusRoot is typically a sub-folder of a git repo OR is itself a git repo.
  // We default to corpusRoot — git -C <corpusRoot> walks up to find the repo
  // automatically.
  return corpusRoot;
}

void inferMemoryGitRepo; // exported for completeness; not used in resolveConfig directly to keep constructor surface flat
export { join };
