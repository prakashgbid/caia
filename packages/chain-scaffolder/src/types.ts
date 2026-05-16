// Scaffolder-side view of a chain spec. We intentionally keep this loose
// (subset of @chiefaia/chain-runner's ChainSpec) so the scaffolder can
// validate output before the runner's stricter loader sees it. Anything
// the scaffolder emits must round-trip through `loadChainSpec` cleanly.

export type Machine = 'm3' | 'm1' | 'stolution';

export interface LooseBacklogItem {
  /** Kebab-case id; becomes the chain id. */
  id: string;
  /** Short title. */
  title: string;
  /** 1-2 line free-form description — what + why. */
  description: string;
  /** Optional caller-supplied file_paths hints. The context gatherer
   *  will grep these for nearby work; if absent the gatherer infers from
   *  the description / id. */
  file_paths?: string[];
  /** Optional machine hint. Defaults to m3-local. */
  machine?: Machine;
  /** Optional explicit deps (chain ids that must be all_done first). */
  deps?: string[];
}

export interface ScaffolderSuccessCriteria {
  output_file: string;
  min_bytes?: number;
  grep_match?: string;
  requires_merged_pr?: boolean;
  enforce?: 'warn' | 'strict';
}

export interface ScaffolderPhase {
  id: number;
  name: string;
  description?: string;
  deps?: number[];
  max_minutes?: number;
  prompt_template: string;
  success_criteria: ScaffolderSuccessCriteria;
}

export interface ScaffolderChainSpec {
  defaults?: {
    max_retries?: number;
    heartbeat_interval_sec?: number;
  };
  chain_config?: {
    alert_channels?: string[];
    max_concurrent?: number;
    acceptance_enforce_default?: 'warn' | 'strict';
    machine?: Machine;
  };
  phases: ScaffolderPhase[];
}

/** Output of the LLM call before schema validation. */
export interface RawLlmScaffold {
  /** The raw text returned by the LLM. */
  raw: string;
  /** The provider that produced the response. */
  provider: 'claude' | 'local' | 'fixture';
  /** Optional usage stats forwarded from the provider. */
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
  };
}

export interface LlmScaffoldResult {
  /** Chain id derived from the backlog item. */
  chain_id: string;
  /** The validated chain spec. */
  spec: ScaffolderChainSpec;
  /** Provider + raw output for audit. */
  raw: RawLlmScaffold;
  /** Validation/retry log — first attempt, retry-with-corrections etc. */
  attempts: Array<{
    n: number;
    ok: boolean;
    errors?: string[];
  }>;
}

/** Pluggable LLM provider. Implementations live in src/providers/. */
export interface LlmProvider {
  name: 'claude' | 'local' | 'fixture';
  /**
   * @param system  System prompt (instructions + few-shot example).
   * @param user    User message (the backlog item + gathered context).
   * @param opts    Provider-specific knobs.
   */
  complete(
    system: string,
    user: string,
    opts?: { maxTokens?: number; temperature?: number },
  ): Promise<RawLlmScaffold>;
}
