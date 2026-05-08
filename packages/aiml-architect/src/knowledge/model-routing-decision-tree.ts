/**
 * Model-routing decision tree.
 */

import type {
  FallbackEntry,
  Hardware,
  ModelChoice,
  Provider,
  SelectModelParams
} from '../types.js';

export interface RoutingRule {
  readonly taskType: string;
  readonly description: string;
  readonly localModel: string;
  readonly claudeModel?: string;
  readonly useLocal: boolean;
  readonly maxTokens: number;
  readonly estimatedCostLocal: string;
  readonly estimatedCostClaude: string;
}

export interface LocalModel {
  readonly tag: string;
  readonly runtimeRamGB: number;
  readonly diskSizeGB: number;
  readonly endpoint: 'generate' | 'chat' | 'embeddings';
}

const HARDWARE_RAM_BUDGET_GB: Record<Hardware, number> = {
  'mac-m1-pro-16gb': 11,
  'mac-m4-32gb': 22,
  cloud: 64
};

const DEFAULT_CLAUDE_MODEL = 'claude-sonnet-4-6';

const LOCAL_CONTEXT_WINDOW: Record<string, number> = {
  'qwen2.5-coder:7b': 32_000,
  'qwen2.5-coder:14b': 32_000,
  'llama3.1:8b': 32_000,
  'qwen3:14b': 32_000,
  'mistral-nemo:12b': 128_000,
  phi4: 16_000,
  'nomic-embed-text': 8_000
};

const CLAUDE_CONTEXT_WINDOW = 200_000;

function parseCostPerCall(costString: string): number {
  const match = costString.match(/\$?([\d.]+)/);
  if (!match) return 0;
  return parseFloat(match[1] ?? '0') / 1000;
}

export interface DecideModelInput {
  readonly params: SelectModelParams;
  readonly rule: RoutingRule;
  readonly localCatalog: ReadonlyArray<LocalModel>;
  readonly apprenticeAdapterReady: boolean;
  readonly apprenticeAdapterName?: string;
  readonly apprenticeAdapterPath?: string;
  readonly hardwareRamBudgetGB?: number;
}

export function decideModel(input: DecideModelInput): ModelChoice {
  const { params, rule, localCatalog, apprenticeAdapterReady } = input;
  const hardware = params.hardware ?? 'mac-m1-pro-16gb';
  const ramBudget =
    input.hardwareRamBudgetGB ?? HARDWARE_RAM_BUDGET_GB[hardware];

  if (params.forceProvider) {
    return forceProviderChoice(input, params.forceProvider);
  }

  if (
    apprenticeAdapterReady &&
    input.apprenticeAdapterName !== undefined &&
    input.apprenticeAdapterPath !== undefined &&
    params.qualityBar !== 'high'
  ) {
    const apprenticeChoice: ModelChoice = {
      provider: 'apprentice',
      model: input.apprenticeAdapterName,
      adapter: input.apprenticeAdapterPath,
      rationale:
        `Apprentice adapter "${input.apprenticeAdapterName}" is blessed for task ` +
        `"${rule.taskType}" and qualityBar=${params.qualityBar} permits adapter use.`,
      fallbackChain: defaultFallbackChain(rule),
      estimatedCostUsd: 0
    };
    return apprenticeChoice;
  }

  if (params.qualityBar === 'high') {
    const claudeModel = rule.claudeModel ?? DEFAULT_CLAUDE_MODEL;
    return {
      provider: 'claude',
      model: claudeModel,
      rationale:
        `qualityBar=high forces Claude regardless of routing rule. ` +
        `Using ${claudeModel} for "${rule.taskType}".`,
      fallbackChain: [{ provider: 'local', model: rule.localModel }],
      estimatedCostUsd: parseCostPerCall(rule.estimatedCostClaude)
    };
  }

  const localModel = localCatalog.find((m) => m.tag === rule.localModel);
  if (localModel && localModel.runtimeRamGB > ramBudget) {
    const claudeModel = rule.claudeModel ?? DEFAULT_CLAUDE_MODEL;
    return {
      provider: 'claude',
      model: claudeModel,
      rationale:
        `Local model "${rule.localModel}" needs ${localModel.runtimeRamGB} GB RAM but ` +
        `hardware "${hardware}" budget is ${ramBudget} GB. Escalating to Claude ` +
        `(${claudeModel}).`,
      fallbackChain: [{ provider: 'local', model: rule.localModel }],
      estimatedCostUsd: parseCostPerCall(rule.estimatedCostClaude)
    };
  }

  const localContextLimit = LOCAL_CONTEXT_WINDOW[rule.localModel] ?? 32_000;
  if (
    rule.useLocal &&
    params.contextSizeTokens > localContextLimit &&
    params.contextSizeTokens <= CLAUDE_CONTEXT_WINDOW
  ) {
    const claudeModel = rule.claudeModel ?? DEFAULT_CLAUDE_MODEL;
    return {
      provider: 'claude',
      model: claudeModel,
      rationale:
        `contextSizeTokens=${params.contextSizeTokens} exceeds local context ` +
        `window for "${rule.localModel}" (${localContextLimit}). Escalating to ` +
        `Claude (${claudeModel}, ${CLAUDE_CONTEXT_WINDOW} window).`,
      fallbackChain: [{ provider: 'local', model: 'mistral-nemo:12b' }],
      estimatedCostUsd: parseCostPerCall(rule.estimatedCostClaude)
    };
  }

  if (rule.useLocal) {
    return {
      provider: 'local',
      model: rule.localModel,
      rationale:
        `Routing rule for "${rule.taskType}" prefers local model ` +
        `"${rule.localModel}" with qualityBar=${params.qualityBar} on ${hardware}.`,
      fallbackChain: rule.claudeModel
        ? [{ provider: 'claude', model: rule.claudeModel }]
        : [],
      estimatedCostUsd: 0
    };
  }
  const claudeModel = rule.claudeModel ?? DEFAULT_CLAUDE_MODEL;
  return {
    provider: 'claude',
    model: claudeModel,
    rationale:
      `Routing rule for "${rule.taskType}" pins Claude (${claudeModel}). ` +
      `Local "${rule.localModel}" available as fallback only.`,
    fallbackChain: [{ provider: 'local', model: rule.localModel }],
    estimatedCostUsd: parseCostPerCall(rule.estimatedCostClaude)
  };
}

function forceProviderChoice(
  input: DecideModelInput,
  forceProvider: Provider
): ModelChoice {
  const { rule } = input;
  if (forceProvider === 'local') {
    return {
      provider: 'local',
      model: rule.localModel,
      rationale: `forceProvider=local override for "${rule.taskType}".`,
      fallbackChain: defaultFallbackChain(rule),
      estimatedCostUsd: 0
    };
  }
  if (forceProvider === 'claude') {
    const claudeModel = rule.claudeModel ?? DEFAULT_CLAUDE_MODEL;
    return {
      provider: 'claude',
      model: claudeModel,
      rationale: `forceProvider=claude override for "${rule.taskType}".`,
      fallbackChain: [{ provider: 'local', model: rule.localModel }],
      estimatedCostUsd: parseCostPerCall(rule.estimatedCostClaude)
    };
  }
  if (
    !input.apprenticeAdapterReady ||
    input.apprenticeAdapterName === undefined ||
    input.apprenticeAdapterPath === undefined
  ) {
    return {
      provider: 'local',
      model: rule.localModel,
      rationale:
        `forceProvider=apprentice requested but no blessed adapter found for ` +
        `"${rule.taskType}". Falling back to local "${rule.localModel}".`,
      fallbackChain: defaultFallbackChain(rule),
      estimatedCostUsd: 0
    };
  }
  return {
    provider: 'apprentice',
    model: input.apprenticeAdapterName,
    adapter: input.apprenticeAdapterPath,
    rationale: `forceProvider=apprentice for "${rule.taskType}".`,
    fallbackChain: defaultFallbackChain(rule),
    estimatedCostUsd: 0
  };
}

function defaultFallbackChain(
  rule: RoutingRule
): ReadonlyArray<FallbackEntry> {
  const out: FallbackEntry[] = [];
  if (rule.useLocal) {
    if (rule.claudeModel) {
      out.push({ provider: 'claude', model: rule.claudeModel });
    }
  } else {
    out.push({ provider: 'local', model: rule.localModel });
  }
  return out;
}
