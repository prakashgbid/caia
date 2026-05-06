import { describe, it, expect } from 'vitest';

import { selectModel } from '../src/select-model.js';
import { resolveConfig } from '../src/config.js';
import { buildFakeAdapterRegistry } from './helpers/fakes.js';

describe('selectModel (integration over @chiefaia/local-llm-router)', () => {
  const cfg = resolveConfig({});
  const noAdapters = buildFakeAdapterRegistry([]);

  it('returns a local choice for code-implementation-simple', () => {
    const choice = selectModel(
      {
        taskCategory: 'code-implementation-simple',
        contextSizeTokens: 1000,
        qualityBar: 'standard'
      },
      { cfg, adapterRegistry: noAdapters }
    );
    expect(choice.provider).toBe('local');
  });

  it('returns claude when qualityBar=high', () => {
    const choice = selectModel(
      {
        taskCategory: 'code-implementation-simple',
        contextSizeTokens: 1000,
        qualityBar: 'high'
      },
      { cfg, adapterRegistry: noAdapters }
    );
    expect(choice.provider).toBe('claude');
  });

  it('returns claude for unknown task with default rule', () => {
    const choice = selectModel(
      {
        taskCategory: 'totally-unknown-task',
        contextSizeTokens: 1000,
        qualityBar: 'high'
      },
      { cfg, adapterRegistry: noAdapters }
    );
    expect(choice.provider).toBe('claude');
  });

  it('picks an apprentice adapter when one is blessed', () => {
    const adapter = buildFakeAdapterRegistry([
      {
        name: 'apprentice-test-domain-classification',
        path: '/tmp/adapter',
        winRate: 0.8,
        forgettingFlags: 0
      }
    ]);
    const choice = selectModel(
      {
        taskCategory: 'domain-classification',
        contextSizeTokens: 1000,
        qualityBar: 'standard'
      },
      { cfg, adapterRegistry: adapter }
    );
    expect(choice.provider).toBe('apprentice');
  });

  it('skips an adapter with forgetting flags', () => {
    const adapter = buildFakeAdapterRegistry([
      {
        name: 'apprentice-test-domain-classification',
        path: '/tmp/adapter',
        winRate: 0.8,
        forgettingFlags: 2
      }
    ]);
    const choice = selectModel(
      {
        taskCategory: 'domain-classification',
        contextSizeTokens: 1000,
        qualityBar: 'standard'
      },
      { cfg, adapterRegistry: adapter }
    );
    expect(choice.provider).not.toBe('apprentice');
  });

  it('skips an adapter below win-rate threshold', () => {
    const adapter = buildFakeAdapterRegistry([
      {
        name: 'apprentice-test-domain-classification',
        path: '/tmp/adapter',
        winRate: 0.4,
        forgettingFlags: 0
      }
    ]);
    const choice = selectModel(
      {
        taskCategory: 'domain-classification',
        contextSizeTokens: 1000,
        qualityBar: 'standard'
      },
      { cfg, adapterRegistry: adapter }
    );
    expect(choice.provider).not.toBe('apprentice');
  });
});
