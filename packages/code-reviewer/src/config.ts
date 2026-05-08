/**
 * @chiefaia/code-reviewer — config resolution.
 *
 * Constructor injects every CAIA-specific path/topic/threshold; defaults
 * resolve from env vars, then from compile-time CAIA defaults. Tests inject
 * fixture corpora and bypass env entirely. Per Option E architecture
 * (`agent_architecture_shape_2026-05-06.md`).
 */

import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

import type { CodeReviewSeverity, FsReader, LlmReviewer } from './types.js';

export interface CodeReviewerAgentConfig {
  conventionsPath?: string;
  reportsRoot?: string;
  eventBusUrl?: string;
  claudeBinaryPath?: string;
  modelTag?: string;
  maxDiffBytes?: number;
  chunkBytes?: number;
  /** Severity floor — findings below this are excluded from `findings`
   * AND ignored for verdict computation. Default: `low`. */
  severityFloor?: CodeReviewSeverity;
  /** Minimum severity that triggers a `request-changes` verdict.
   * Default: `medium`. (i.e. `low` findings never block.) */
  blockingSeverityThreshold?: CodeReviewSeverity;
  perVectorTimeoutMs?: number;
  maxFindingsPerPr?: number;
  enableLlmReasoning?: boolean;
  enableDeterministic?: boolean;
  /** DI seams — tests inject fakes. */
  fs?: FsReader;
  llm?: LlmReviewer;
  clock?: () => Date;
}

export interface ResolvedCodeReviewerAgentConfig {
  conventionsPath: string;
  reportsRoot: string;
  eventBusUrl: string;
  claudeBinaryPath: string;
  modelTag: string;
  maxDiffBytes: number;
  chunkBytes: number;
  severityFloor: CodeReviewSeverity;
  blockingSeverityThreshold: CodeReviewSeverity;
  perVectorTimeoutMs: number;
  maxFindingsPerPr: number;
  enableLlmReasoning: boolean;
  enableDeterministic: boolean;
}

/** Expand a leading `~/` to the operator's home dir. */
export function expandHome(p: string): string {
  if (p.startsWith('~/')) return resolve(homedir(), p.slice(2));
  if (p === '~') return homedir();
  return p;
}

const DEFAULT_REPO_GUESS = join(homedir(), 'Documents/projects/caia');
const DEFAULT_CONVENTIONS_PATH = join(DEFAULT_REPO_GUESS, 'AGENTS.md');

const DEFAULT_REPORTS_ROOT = '~/Documents/projects/reports';
const DEFAULT_EVENT_BUS_URL = 'tcp://localhost:7777';
const DEFAULT_CLAUDE_BINARY = 'claude';
const DEFAULT_MODEL_TAG = 'claude-haiku-4-5-20251001';

const DEFAULT_MAX_DIFF_BYTES = 256_000;
const DEFAULT_CHUNK_BYTES = 64_000;
const DEFAULT_SEVERITY_FLOOR: CodeReviewSeverity = 'low';
const DEFAULT_BLOCKING_THRESHOLD: CodeReviewSeverity = 'medium';
const DEFAULT_PER_VECTOR_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_FINDINGS_PER_PR = 50;

export function resolveConfig(input: CodeReviewerAgentConfig = {}): ResolvedCodeReviewerAgentConfig {
  const conventionsPath = expandHome(
    input.conventionsPath
    ?? process.env['CAIA_CONVENTIONS_PATH']
    ?? DEFAULT_CONVENTIONS_PATH
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
    ?? process.env['CODE_REVIEWER_MODEL_TAG']
    ?? DEFAULT_MODEL_TAG;

  const maxDiffBytes =
    input.maxDiffBytes
    ?? (Number(process.env['CODE_REVIEWER_MAX_DIFF_BYTES']) || DEFAULT_MAX_DIFF_BYTES);
  const chunkBytes =
    input.chunkBytes
    ?? (Number(process.env['CODE_REVIEWER_CHUNK_BYTES']) || DEFAULT_CHUNK_BYTES);
  const severityFloor: CodeReviewSeverity =
    input.severityFloor
    ?? (process.env['CODE_REVIEWER_SEVERITY_FLOOR'] as CodeReviewSeverity | undefined)
    ?? DEFAULT_SEVERITY_FLOOR;
  const blockingSeverityThreshold: CodeReviewSeverity =
    input.blockingSeverityThreshold
    ?? (process.env['CODE_REVIEWER_BLOCKING_THRESHOLD'] as CodeReviewSeverity | undefined)
    ?? DEFAULT_BLOCKING_THRESHOLD;
  const perVectorTimeoutMs =
    input.perVectorTimeoutMs
    ?? (Number(process.env['CODE_REVIEWER_VECTOR_TIMEOUT_MS']) || DEFAULT_PER_VECTOR_TIMEOUT_MS);
  const maxFindingsPerPr =
    input.maxFindingsPerPr
    ?? (Number(process.env['CODE_REVIEWER_MAX_FINDINGS']) || DEFAULT_MAX_FINDINGS_PER_PR);

  const enableLlmReasoning =
    input.enableLlmReasoning
    ?? (process.env['CODE_REVIEWER_LLM_ENABLED'] !== '0');
  const enableDeterministic =
    input.enableDeterministic
    ?? (process.env['CODE_REVIEWER_DETERMINISTIC_ENABLED'] !== '0');

  return {
    conventionsPath,
    reportsRoot,
    eventBusUrl,
    claudeBinaryPath,
    modelTag,
    maxDiffBytes,
    chunkBytes,
    severityFloor,
    blockingSeverityThreshold,
    perVectorTimeoutMs,
    maxFindingsPerPr,
    enableLlmReasoning,
    enableDeterministic
  };
}
