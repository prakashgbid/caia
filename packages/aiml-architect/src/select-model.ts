/**
 * Implementation of `selectModel()`.
 */

import type { LocalModel as RouterLocalModel, RoutingRule as RouterRoutingRule } from '@chiefaia/local-llm-router';
import { MODEL_CATALOG, getRoute } from '@chiefaia/local-llm-router';

import type { ResolvedAIMLArchitectConfig } from './config.js';
import type {
  AdapterRegistryReader,
  ModelChoice,
  SelectModelParams
} from './types.js';
import {
  decideModel,
  type LocalModel,
  type RoutingRule
} from './knowledge/model-routing-decision-tree.js';

function projectRule(rule: RouterRoutingRule): RoutingRule {
  return rule.claudeModel === undefined
    ? {
        taskType: rule.taskType,
        description: rule.description,
        localModel: rule.localModel,
        useLocal: rule.useLocal,
        maxTokens: rule.maxTokens,
        estimatedCostLocal: rule.estimatedCostLocal,
        estimatedCostClaude: rule.estimatedCostClaude
      }
    : {
        taskType: rule.taskType,
        description: rule.description,
        localModel: rule.localModel,
        claudeModel: rule.claudeModel,
        useLocal: rule.useLocal,
        maxTokens: rule.maxTokens,
        estimatedCostLocal: rule.estimatedCostLocal,
        estimatedCostClaude: rule.estimatedCostClaude
      };
}

function projectModel(m: RouterLocalModel): LocalModel {
  return {
    tag: m.tag,
    runtimeRamGB: m.runtimeRamGB,
    diskSizeGB: m.diskSizeGB,
    endpoint: m.endpoint
  };
}

export interface SelectModelDeps {
  readonly cfg: ResolvedAIMLArchitectConfig;
  readonly adapterRegistry: AdapterRegistryReader;
  readonly localCatalog?: ReadonlyArray<LocalModel>;
  readonly getRule?: (taskType: string) => RoutingRule;
}

function findBlessedAdapter(
  registry: AdapterRegistryReader,
  taskCategory: string,
  promotionThreshold: number
): { name: string; path: string } | null {
  const all = registry.list();
  const matches = all.filter(
    (a) =>
      a.name.toLowerCase().includes(taskCategory.toLowerCase()) &&
      typeof a.winRate === 'number' &&
      a.winRate >= promotionThreshold &&
      (a.forgettingFlags ?? 0) === 0
  );
  if (matches.length === 0) return null;
  matches.sort((a, b) => (b.winRate ?? 0) - (a.winRate ?? 0));
  const best = matches[0];
  if (!best) return null;
  return { name: best.name, path: best.path };
}

export function selectModel(
  params: SelectModelParams,
  deps: SelectModelDeps
): ModelChoice {
  const localCatalog =
    deps.localCatalog ?? MODEL_CATALOG.map(projectModel);
  const rule =
    deps.getRule?.(params.taskCategory) ??
    projectRule(getRoute(params.taskCategory));

  const adapter = findBlessedAdapter(
    deps.adapterRegistry,
    params.taskCategory,
    deps.cfg.promotionWinRateThreshold
  );

  return decideModel(
    adapter !== null
      ? {
          params,
          rule,
          localCatalog,
          apprenticeAdapterReady: true,
          apprenticeAdapterName: adapter.name,
          apprenticeAdapterPath: adapter.path
        }
      : {
          params,
          rule,
          localCatalog,
          apprenticeAdapterReady: false
        }
  );
}
