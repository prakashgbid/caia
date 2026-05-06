/**
 * @chiefaia/critic — config resolution.
 *
 * Constructor injects every CAIA-specific path/topic/threshold; defaults
 * resolve from env vars, then from compile-time CAIA defaults. Tests inject
 * fixture corpora and bypass env entirely.
 */

import { homedir } from 'node:os';
import { resolve, join } from 'node:path';

import type { FsReader, LlmReasoner, Severity } from './types.js';

export interface CriticAgentConfig {
  taxonomyPath?: string;
  memoryRoot?: string;
  reportsRoot?: string;
  eventBusUrl?: string;
  claudeBinaryPath?: string;
  modelTag?: string;
  maxDiffBytes?: number;
  chunkBytes?: number;
  severityFloor?: Severity;
  perVectorTimeoutMs?: number;
  maxFindingsPerPr?: number;
  enableLlmReasoning?: boolean;
  enableDeterministic?: boolean;
  /** DI seams — tests inject fakes. */
  fs?: FsReader;
  llm?: LlmReasoner;
  clock?: () => Date;
}

export interface ResolvedCriticAgentConfig {
  taxonomyPath: string;
  memoryRoot: string;
  reportsRoot: string;
  eventBusUrl: string;
  claudeBinaryPath: string;
  modelTag: string;
  maxDiffBytes: number;
  chunkBytes: number;
  severityFloor: Severity;
  perVectorTimeoutMs: number;
  maxFindingsPerPr: number;
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
const DEFAULT_SEVERITY_FLOOR: Severity = 'low';
const DEFAULT_PER_VECTOR_TIMEOUT_MS = 60_000;
const DEFAULT_MAX_FINDINGS_PER_PR = 50;

export function resolveConfig(input: CriticAgentConfig = {}): ResolvedCriticAgentConfig {
  const memoryRoot = expandHome(
    input.memoryRoot
    ?? process.env['CAIA_MEMORY_ROOT']
    ?? DEFAULT_MEMORY_ROOT_GUESS
  );
  const taxonomyPath = expandHome(
    input.taxonomyPath
    ?? process.env['CAIA_TAXONOMY_PATH']
    ?? join(memoryRoot, 'mentor_agent_directive.md')
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
    ?? process.env['CRITIC_MODEL_TAG']
    ?? DEFAULT_MODEL_TAG;

  const maxDiffBytes =
    input.maxDiffBytes
    ?? (Number(process.env['CRITIC_MAX_DIFF_BYTES']) || DEFAULT_MAX_DIFF_BYTES);
  const chunkBytes =
    input.chunkBytes
    ?? (Number(process.env['CRITIC_CHUNK_BYTES']) || DEFAULT_CHUNK_BYTES);
  const severityFloor: Severity =
    input.severityFloor
    ?? (process.env['CRITIC_SEVERITY_FLOOR'] as Severity | undefined)
    ?? DEFAULT_SEVERITY_FLOOR;
  const perVectorTimeoutMs =
    input.perVectorTimeoutMs
    ?? (Number(process.env['CRITIC_VECTOR_TIMEOUT_MS']) || DEFAULT_PER_VECTOR_TIMEOUT_MS);
  const maxFindingsPerPr =
    input.maxFindingsPerPr
    ?? (Number(process.env['CRITIC_MAX_FINDINGS']) || DEFAULT_MAX_FINDINGS_PER_PR);

  const enableLlmReasoning =
    input.enableLlmReasoning
    ?? (process.env['CRITIC_LLM_ENABLED'] !== '0');
  const enableDeterministic =
    input.enableDeterministic
    ?? (process.env['CRITIC_DETERMINISTIC_ENABLED'] !== '0');

  return {
    taxonomyPath,
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
    enableLlmReasoning,
    enableDeterministic
  };
}
