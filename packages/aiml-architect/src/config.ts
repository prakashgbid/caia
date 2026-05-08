/**
 * Configuration shape + CAIA defaults.
 *
 * Option E pre-send check: every CAIA-specific path/topic/registry is here
 * with a default. Tests inject overrides; production passes CAIA-only.
 */

import { homedir } from 'node:os';
import { join } from 'node:path';

import type {
  AdapterRegistryReader,
  CuratorReader,
  FsReader,
  Hardware,
  MentorReader
} from './types.js';

/** Public config — every field is optional; CAIA defaults fill the gaps. */
export interface AIMLArchitectConfig {
  // ── Source paths ─────────────────────────────────────────────────────
  readonly apprenticeEvalSuiteRoot?: string;
  readonly canonicalSuitePath?: string;
  readonly promptfooEvalRoot?: string;
  readonly conventionsDocPath?: string;
  readonly mentorEventsDbPath?: string;
  readonly curatorScanRoot?: string;
  readonly apprenticeAdapterRegistryRoot?: string;
  readonly apprenticeCorpusRoot?: string;

  // ── Behaviour knobs ─────────────────────────────────────────────────
  readonly retrainTriggerWindowDays?: number;
  readonly retrainTriggerThreshold?: number;
  readonly retrainCostBudgetUsd?: number;
  readonly promotionWinRateThreshold?: number;
  readonly forgettingThreshold?: number;
  readonly preferLocalIfRamGB?: number;
  readonly defaultHardware?: Hardware;

  // ── Test seams (DI) ──────────────────────────────────────────────────
  readonly fs?: FsReader;
  readonly mentor?: MentorReader;
  readonly curator?: CuratorReader;
  readonly adapterRegistry?: AdapterRegistryReader;
  readonly clock?: () => Date;
}

/** Resolved config — all fields filled with defaults. Internal-only. */
export interface ResolvedAIMLArchitectConfig {
  readonly apprenticeEvalSuiteRoot: string;
  readonly canonicalSuitePath: string;
  readonly promptfooEvalRoot: string;
  readonly conventionsDocPath: string;
  readonly mentorEventsDbPath: string;
  readonly curatorScanRoot: string;
  readonly apprenticeAdapterRegistryRoot: string;
  readonly apprenticeCorpusRoot: string;
  readonly retrainTriggerWindowDays: number;
  readonly retrainTriggerThreshold: number;
  readonly retrainCostBudgetUsd: number;
  readonly promotionWinRateThreshold: number;
  readonly forgettingThreshold: number;
  readonly preferLocalIfRamGB: number;
  readonly defaultHardware: Hardware;
}

/** Resolve `~` to `$HOME`. Returns `path` unchanged if it doesn't start with `~/`. */
export function expandHome(path: string): string {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
}

/** Build the resolved config from a partial input. */
export function resolveConfig(
  input: AIMLArchitectConfig
): ResolvedAIMLArchitectConfig {
  return {
    apprenticeEvalSuiteRoot: expandHome(
      input.apprenticeEvalSuiteRoot
        ?? process.env['CAIA_APPRENTICE_SUITE_ROOT']
        ?? 'packages/apprentice-eval/suites'
    ),
    canonicalSuitePath: expandHome(
      input.canonicalSuitePath
        ?? process.env['CAIA_CANONICAL_SUITE_PATH']
        ?? 'packages/apprentice-eval/suites/canonical-100.yaml'
    ),
    promptfooEvalRoot: expandHome(
      input.promptfooEvalRoot
        ?? process.env['CAIA_PROMPTFOO_EVAL_ROOT']
        ?? 'packages/prompt-evals/evals'
    ),
    conventionsDocPath: expandHome(
      input.conventionsDocPath
        ?? process.env['CAIA_AIML_CONVENTIONS_DOC']
        ?? 'caia/docs/ai-ml-architecture-conventions.md'
    ),
    mentorEventsDbPath: expandHome(
      input.mentorEventsDbPath
        ?? process.env['CAIA_EVENTS_DB']
        ?? '~/.caia/mentor/events.sqlite'
    ),
    curatorScanRoot: expandHome(
      input.curatorScanRoot
        ?? process.env['CAIA_CURATOR_SCAN_ROOT']
        ?? '~/Documents/projects/reports'
    ),
    apprenticeAdapterRegistryRoot: expandHome(
      input.apprenticeAdapterRegistryRoot
        ?? process.env['APPRENTICE_ADAPTER_ROOT']
        ?? '~/Documents/projects/apprentice/adapters'
    ),
    apprenticeCorpusRoot: expandHome(
      input.apprenticeCorpusRoot
        ?? process.env['APPRENTICE_CORPUS_ROOT']
        ?? '~/Documents/projects/apprentice/corpora'
    ),
    retrainTriggerWindowDays: input.retrainTriggerWindowDays ?? 7,
    retrainTriggerThreshold: input.retrainTriggerThreshold ?? 5,
    retrainCostBudgetUsd: input.retrainCostBudgetUsd ?? 5,
    promotionWinRateThreshold: input.promotionWinRateThreshold ?? 0.6,
    forgettingThreshold: input.forgettingThreshold ?? 0.1,
    preferLocalIfRamGB: input.preferLocalIfRamGB ?? 11,
    defaultHardware: input.defaultHardware ?? 'mac-m1-pro-16gb'
  };
}
