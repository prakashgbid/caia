/**
 * Configuration shape + CAIA defaults.
 *
 * Option E pre-send check: every CAIA-specific path/URL/topic is here
 * with a default. Tests inject overrides; production passes CAIA-only.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  ClaudeDistiller,
  EventBusClient,
  FsReader,
  GithubClient,
  LangfuseClient
} from './types.js';

/** Public config — every field is optional; CAIA defaults fill the gaps. */
export interface ApprenticeCorpusConfig {
  // ── Source paths / URLs ──────────────────────────────────────────────
  memoryRoot?: string;
  reportsRoot?: string;
  eventsDbPath?: string;
  langfuseProjectId?: string;
  langfuseEnabled?: boolean;
  githubRepo?: string;

  // ── Output ───────────────────────────────────────────────────────────
  outputRoot?: string;

  // ── External binaries ────────────────────────────────────────────────
  claudeBinaryPath?: string;
  distillEnabled?: boolean;

  // ── Behaviour knobs ──────────────────────────────────────────────────
  maxSamples?: number;
  minSampleLengthChars?: number;
  maxSampleLengthChars?: number;
  qualityThreshold?: number;
  maxDistillCalls?: number;
  maxAgeDays?: number;
  redactPII?: boolean;
  /** Optional extra patterns the PII masker should redact. */
  extraRedactPatterns?: ReadonlyArray<{ tag: string; pattern: RegExp; replacement: string }>;

  // ── Test seams (DI) ──────────────────────────────────────────────────
  fs?: FsReader;
  eventBus?: EventBusClient;
  github?: GithubClient;
  langfuse?: LangfuseClient;
  claudeDistiller?: ClaudeDistiller;
  /** Override `now()` for deterministic tests. */
  clock?: () => Date;
}

/**
 * The fully-resolved config — all fields required, defaults filled in.
 * Internal-only. The aggregator works against this shape.
 */
export interface ResolvedApprenticeCorpusConfig {
  memoryRoot: string;
  reportsRoot: string;
  eventsDbPath: string;
  langfuseProjectId: string;
  langfuseEnabled: boolean;
  githubRepo: string;
  outputRoot: string;
  claudeBinaryPath: string;
  distillEnabled: boolean;
  maxSamples: number;
  minSampleLengthChars: number;
  maxSampleLengthChars: number;
  qualityThreshold: number;
  maxDistillCalls: number;
  maxAgeDays: number;
  redactPII: boolean;
  extraRedactPatterns: ReadonlyArray<{ tag: string; pattern: RegExp; replacement: string }>;
}

/** Resolve `~` to `$HOME` in a path. Returns `path` unchanged if it doesn't start with `~/`. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/**
 * Default memory root.
 *
 * The orchestrator's session-state directory lives under
 * `~/Library/Application Support/Claude/local-agent-mode-sessions/<session-id>/agent/memory`.
 * The session id is dynamic, so production callers should set
 * `CAIA_MEMORY_DIR` at the env level (a launchd plist or systemd-style
 * env file). The fallback below points to the canonical 2026-05-06
 * session for first-run convenience; do not rely on it to outlive
 * session rotation.
 */
const FALLBACK_MEMORY_ROOT =
  '/Users/MAC/Library/Application Support/Claude/local-agent-mode-sessions/6c9158cd-cd01-44af-b82f-bf27b437c618/84f7697e-7ae3-4ba4-9f98-166613a82e98/agent/memory';

/** Build the resolved config from a partial input. */
export function resolveConfig(input: ApprenticeCorpusConfig): ResolvedApprenticeCorpusConfig {
  return {
    memoryRoot: expandHome(
      input.memoryRoot ?? process.env['CAIA_MEMORY_DIR'] ?? FALLBACK_MEMORY_ROOT
    ),
    reportsRoot: expandHome(
      input.reportsRoot
        ?? process.env['CAIA_REPORTS_DIR']
        ?? '~/Documents/projects/reports'
    ),
    eventsDbPath: expandHome(
      input.eventsDbPath
        ?? process.env['CAIA_EVENTS_DB']
        ?? '~/.caia/mentor/events.sqlite'
    ),
    langfuseProjectId: input.langfuseProjectId ?? 'caia-prod',
    langfuseEnabled: input.langfuseEnabled ?? false,
    githubRepo: input.githubRepo ?? process.env['CAIA_GITHUB_REPO'] ?? 'chiefaia/caia',
    outputRoot: expandHome(
      input.outputRoot
        ?? process.env['APPRENTICE_CORPUS_ROOT']
        ?? '~/Documents/projects/apprentice/corpora'
    ),
    claudeBinaryPath:
      input.claudeBinaryPath ?? process.env['CLAUDE_BINARY_PATH'] ?? 'claude',
    distillEnabled: input.distillEnabled ?? true,
    maxSamples: input.maxSamples ?? 50_000,
    minSampleLengthChars: input.minSampleLengthChars ?? 80,
    maxSampleLengthChars: input.maxSampleLengthChars ?? 16_000,
    qualityThreshold: input.qualityThreshold ?? 0.4,
    maxDistillCalls: input.maxDistillCalls ?? 200,
    maxAgeDays: input.maxAgeDays ?? 365,
    redactPII: input.redactPII ?? true,
    extraRedactPatterns: input.extraRedactPatterns ?? []
  };
}

/**
 * Hash the resolved config for the manifest. Excludes function-shaped
 * fields (clock, fs reader, etc.) so the same config yields the same
 * hash across tests. Uses a stable JSON projection.
 */
export function snapshotConfigForHash(cfg: ResolvedApprenticeCorpusConfig): string {
  return JSON.stringify({
    memoryRoot: cfg.memoryRoot,
    reportsRoot: cfg.reportsRoot,
    eventsDbPath: cfg.eventsDbPath,
    langfuseProjectId: cfg.langfuseProjectId,
    langfuseEnabled: cfg.langfuseEnabled,
    githubRepo: cfg.githubRepo,
    outputRoot: cfg.outputRoot,
    distillEnabled: cfg.distillEnabled,
    maxSamples: cfg.maxSamples,
    minSampleLengthChars: cfg.minSampleLengthChars,
    maxSampleLengthChars: cfg.maxSampleLengthChars,
    qualityThreshold: cfg.qualityThreshold,
    maxDistillCalls: cfg.maxDistillCalls,
    maxAgeDays: cfg.maxAgeDays,
    redactPII: cfg.redactPII
  });
}
