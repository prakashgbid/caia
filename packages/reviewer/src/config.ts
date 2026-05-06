/**
 * @chiefaia/reviewer — config resolution.
 *
 * Constructor injects every CAIA-specific path/topic/threshold; defaults
 * resolve from env vars, then from compile-time CAIA defaults. Tests inject
 * fixture corpora and bypass env entirely.
 */

import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

import type { CraftsmanshipSeverity, FsReader, LlmReviewer } from './types.js';

export interface ReviewerAgentConfig {
  conventionsPath?: string;
  memoryRoot?: string;
  reportsRoot?: string;
  eventBusUrl?: string;
  claudeBinaryPath?: string;
  modelTag?: string;
  maxDiffBytes?: number;
  chunkBytes?: number;
  severityFloor?: CraftsmanshipSeverity;
  perVectorTimeoutMs?: number;
  maxFindingsPerPr?: number;
  maxFunctionLines?: number;
  maxFileLines?: number;
  maxNestingDepth?: number;
  enableLlmReasoning?: boolean;
  enableDeterministic?: boolean;
  /** DI seams — tests inject fakes. */
  fs?: FsReader;
  llm?: LlmReviewer;
  clock?: () => Date;
}

export interface ResolvedReviewerAgentConfig {
  conventionsPath: string;
  memoryRoot: string;
  reportsRoot: string;
  eventBusUrl: string;
  claudeBinaryPath: string;
  modelTag: string;
  maxDiffBytes: number;
  chunkBytes: number;
  severityFloor: CraftsmanshipSeverity;
  perVectorTimeoutMs: number;
  maxFindingsPerPr: number;
  maxFunctionLines: number;
  maxFileLines: number;
  maxNestingDepth: number;
  enableLlmReasoning: boolean;
  enableDeterministic: boolean;
}

/**
 * Expand a leading `~/` to the operator's home dir. Anything else is
 * returned untouched. We deliberately do NOT resolve symlinks here — paths
 * that escape the operator-controlled trust boundary should be caught by
 * the caller, not this helper.
 */
export function expandHome(p: string): string {
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

const DEFAULT_REPO_GUESS = join(homedir(), 'Documents/projects/caia');
const DEFAULT_CONVENTIONS_PATH = join(DEFAULT_REPO_GUESS, 'AGENTS.md');
const DEFAULT_MEMORY_ROOT_GUESS = join(
  homedir(),
  'Library/Application Support/Claude/local-agent-mode-sessions'
);

const DEFAULT_REPORTS_ROOT = '~/Documents/projects/reports';
const DEFAULT_EVENT_BUS_URL = 'tcp://localhost:7777';
const DEFAULT_CLAUDE_BINARY = 'claude';
const DEFAULT_MODEL_TAG = 'claude-haiku-4-5-20251001';

const DEFAULT_MAX_DIFF_BYTES = 256_000;
const DEFAULT_CHUNK_BYTES = 64_000;
const DEFAULT_SEVERITY_FLOOR: CraftsmanshipSeverity = 'nit';
const DEFAULT_PER_VECTOR_TIMEOUT_MS = 60_000;
// Industry sweet-spot for craftsmanship review is ~5-10 findings; we cap at
// 30 to permit a noisier dry-run without total saturation.
const DEFAULT_MAX_FINDINGS_PER_PR = 30;
const DEFAULT_MAX_FUNCTION_LINES = 60;
const DEFAULT_MAX_FILE_LINES = 500;
const DEFAULT_MAX_NESTING_DEPTH = 4;

export function resolveConfig(input: ReviewerAgentConfig = {}): ResolvedReviewerAgentConfig {
  const conventionsPath = expandHome(
    input.conventionsPath
    ?? process.env['CAIA_CONVENTIONS_PATH']
    ?? DEFAULT_CONVENTIONS_PATH
  );
  const memoryRoot = expandHome(
    input.memoryRoot
    ?? process.env['CAIA_MEMORY_ROOT']
    ?? DEFAULT_MEMORY_ROOT_GUESS
  );
  const reportsRoot = expandHome(
    input.reportsRoot
    ?? process.env['CAIA_REPORTS_ROOT']
    ?? DEFAULT_REPORTS_ROOT
  );
  const eventBusUrl =
    input.eventBusUrl
    ?? process.env['MENTOR_EVENT_BUS_URL']
    ?? DEFAULT_EVENT_BUS_URL;
  const claudeBinaryPath =
    input.claudeBinaryPath
    ?? process.env['CLAUDE_BINARY_PATH']
    ?? DEFAULT_CLAUDE_BINARY;
  const modelTag =
    input.modelTag
    ?? process.env['REVIEWER_MODEL_TAG']
    ?? DEFAULT_MODEL_TAG;

  const maxDiffBytes =
    input.maxDiffBytes
    ?? (Number(process.env['REVIEWER_MAX_DIFF_BYTES']) || DEFAULT_MAX_DIFF_BYTES);
  const chunkBytes =
    input.chunkBytes
    ?? (Number(process.env['REVIEWER_CHUNK_BYTES']) || DEFAULT_CHUNK_BYTES);
  const severityFloor: CraftsmanshipSeverity =
    input.severityFloor
    ?? (process.env['REVIEWER_SEVERITY_FLOOR'] as CraftsmanshipSeverity | undefined)
    ?? DEFAULT_SEVERITY_FLOOR;
  const perVectorTimeoutMs =
    input.perVectorTimeoutMs
    ?? (Number(process.env['REVIEWER_VECTOR_TIMEOUT_MS']) || DEFAULT_PER_VECTOR_TIMEOUT_MS);
  const maxFindingsPerPr =
    input.maxFindingsPerPr
    ?? (Number(process.env['REVIEWER_MAX_FINDINGS']) || DEFAULT_MAX_FINDINGS_PER_PR);

  const maxFunctionLines =
    input.maxFunctionLines
    ?? (Number(process.env['REVIEWER_MAX_FUNCTION_LINES']) || DEFAULT_MAX_FUNCTION_LINES);
  const maxFileLines =
    input.maxFileLines
    ?? (Number(process.env['REVIEWER_MAX_FILE_LINES']) || DEFAULT_MAX_FILE_LINES);
  const maxNestingDepth =
    input.maxNestingDepth
    ?? (Number(process.env['REVIEWER_MAX_NESTING_DEPTH']) || DEFAULT_MAX_NESTING_DEPTH);

  const enableLlmReasoning =
    input.enableLlmReasoning
    ?? (process.env['REVIEWER_LLM_ENABLED'] !== '0');
  const enableDeterministic =
    input.enableDeterministic
    ?? (process.env['REVIEWER_DETERMINISTIC_ENABLED'] !== '0');

  return {
    conventionsPath,
    memoryRoot,
    reportsRoot,
    eventBusUrl,
    claudeBinaryPath,
    modelTag,
    maxDiffBytes,
    chunkBytes,
    severityFloor,
    perVectorTimeoutMs,
    maxFindingsPerPr,
    maxFunctionLines,
    maxFileLines,
    maxNestingDepth,
    enableLlmReasoning,
    enableDeterministic
  };
}
