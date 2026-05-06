import { describe, it, expect } from 'vitest';

import {
  decideModel,
  type DecideModelInput,
  type LocalModel,
  type RoutingRule
} from '../src/knowledge/model-routing-decision-tree.js';

const fixtureLocalCatalog: LocalModel[] = [
  { tag: 'qwen2.5-coder:7b', runtimeRamGB: 4.5, diskSizeGB: 4.7, endpoint: 'generate' },
  { tag: 'qwen2.5-coder:14b', runtimeRamGB: 8.5, diskSizeGB: 9.0, endpoint: 'generate' },
  { tag: 'phi4', runtimeRamGB: 9.1, diskSizeGB: 9.1, endpoint: 'generate' }
];

const fixtureRule: RoutingRule = {
  taskType: 'code-implementation-simple',
  description: 'fixture',
  localModel: 'qwen2.5-coder:7b',
  claudeModel: 'claude-sonnet-4-6',
  useLocal: true,
  maxTokens: 4000,
  estimatedCostLocal: '$0.00',
  estimatedCostClaude: '$1.00'
};

function baseInput(overrides: Partial<DecideModelInput>): DecideModelInput {
  return {
    params: {
      taskCategory: 'code-implementation-simple',
      contextSizeTokens: 1000,
      qualityBar: 'standard'
    },
    rule: fixtureRule,
    localCatalog: fixtureLocalCatalog,
    apprenticeAdapterReady: false,
    ...overrides
  };
}

describe('decideModel', () => {
  it('uses local model when rule says useLocal=true', () => {
    const choice = decideModel(baseInput({}));
    expect(choice.provider).toBe('local');
    expect(choice.model).toBe('qwen2.5-coder:7b');
    expect(choice.estimatedCostUsd).toBe(0);
  });

  it('escalates to Claude when qualityBar=high', () => {
    const choice = decideModel(
      baseInput({
        params: {
          taskCategory: 'code-implementation-simple',
          contextSizeTokens: 1000,
          qualityBar: 'high'
        }
      })
    );
    expect(choice.provider).toBe('claude');
    expect(choice.model).toBe('claude-sonnet-4-6');
  });

  it('escalates to Claude when local RAM exceeds budget', () => {
    const heavyRule: RoutingRule = {
      ...fixtureRule,
      localModel: 'phi4'
    };
    const choice = decideModel(
      baseInput({
        rule: heavyRule,
        hardwareRamBudgetGB: 8
      })
    );
    expect(choice.provider).toBe('claude');
    expect(choice.rationale).toMatch(/RAM/);
  });

  it('escalates to Claude when context exceeds local window', () => {
    const choice = decideModel(
      baseInput({
        params: {
          taskCategory: 'code-implementation-simple',
          contextSizeTokens: 100_000,
          qualityBar: 'standard'
        }
      })
    );
    expect(choice.provider).toBe('claude');
    expect(choice.rationale).toMatch(/context/i);
  });

  it('respects forceProvider=local', () => {
    const claudeRule: RoutingRule = { ...fixtureRule, useLocal: false };
    const choice = decideModel(
      baseInput({
        rule: claudeRule,
        params: {
          taskCategory: 'code-implementation-simple',
          contextSizeTokens: 1000,
          qualityBar: 'standard',
          forceProvider: 'local'
        }
      })
    );
    expect(choice.provider).toBe('local');
  });

  it('respects forceProvider=apprentice when adapter present', () => {
    const choice = decideModel(
      baseInput({
        apprenticeAdapterReady: true,
        apprenticeAdapterName: 'apprentice-test',
        apprenticeAdapterPath: '/tmp/adapter',
        params: {
          taskCategory: 'code-implementation-simple',
          contextSizeTokens: 1000,
          qualityBar: 'standard',
          forceProvider: 'apprentice'
        }
      })
    );
    expect(choice.provider).toBe('apprentice');
    expect(choice.adapter).toBe('/tmp/adapter');
  });

  it('falls back to local when forceProvider=apprentice but no adapter', () => {
    const choice = decideModel(
      baseInput({
        apprenticeAdapterReady: false,
        params: {
          taskCategory: 'code-implementation-simple',
          contextSizeTokens: 1000,
          qualityBar: 'standard',
          forceProvider: 'apprentice'
        }
      })
    );
    expect(choice.provider).toBe('local');
  });

  it('prefers apprentice when adapter ready and qualityBar≠high', () => {
    const choice = decideModel(
      baseInput({
        apprenticeAdapterReady: true,
        apprenticeAdapterName: 'apprentice-test',
        apprenticeAdapterPath: '/tmp/adapter'
      })
    );
    expect(choice.provider).toBe('apprentice');
  });

  it('falls through to claude when rule pins useLocal=false', () => {
    const claudePinRule: RoutingRule = { ...fixtureRule, useLocal: false };
    const choice = decideModel(baseInput({ rule: claudePinRule }));
    expect(choice.provider).toBe('claude');
  });

  it('builds a sensible fallback chain', () => {
    const choice = decideModel(baseInput({}));
    expect(choice.fallbackChain.length).toBeGreaterThan(0);
    expect(choice.fallbackChain[0]!.provider).toBe('claude');
  });
});
