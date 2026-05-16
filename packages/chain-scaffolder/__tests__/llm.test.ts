import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { scaffoldFromLlm } from '../src/llm.js';
import { makeFixtureProvider } from '../src/providers.js';
import { SchemaError } from '../src/schema.js';
import type { LlmProvider } from '../src/types.js';

const FIXTURE_DIR = resolve(__dirname, '../tests/fixtures');

function fixtureProviderFromFile(path: string): LlmProvider {
  return makeFixtureProvider(readFileSync(resolve(FIXTURE_DIR, path), 'utf8'));
}

describe('scaffoldFromLlm', () => {
  it('parses a fenced YAML response and finalises chain_config', async () => {
    const result = await scaffoldFromLlm(
      {
        id: 'loose-demo',
        title: 'Loose demo item',
        description: 'Add an LRU cache for widget lookups in the demo package.',
      },
      {
        providerInstance: fixtureProviderFromFile('loose_item_response.yaml'),
        routerBaseUrl: null,
        cwd: '/tmp',
        grepImpl: async () => [],
        fewShotExamplePath: resolve(FIXTURE_DIR, 'example_chain.yaml'),
      },
    );

    expect(result.chain_id).toBe('loose-demo');
    expect(result.spec.phases).toHaveLength(1);
    expect(result.spec.phases[0].name).toBe('implement_widget_cache');
    expect(result.spec.chain_config?.machine).toBe('m3'); // finalised default
    expect(result.attempts).toEqual([{ n: 1, ok: true }]);
  });

  it('retries once with corrections when the first response is malformed', async () => {
    const responses = JSON.parse(readFileSync(resolve(FIXTURE_DIR, 'malformed_then_correct.json'), 'utf8')) as {
      first: string;
      second: string;
    };
    let call = 0;
    const provider: LlmProvider = {
      name: 'fixture',
      async complete() {
        call++;
        return { raw: call === 1 ? responses.first : responses.second, provider: 'fixture' };
      },
    };
    const result = await scaffoldFromLlm(
      { id: 'retry-demo', title: 'Retry demo', description: 'Validate the retry path.' },
      {
        providerInstance: provider,
        routerBaseUrl: null,
        cwd: '/tmp',
        grepImpl: async () => [],
        fewShotExamplePath: resolve(FIXTURE_DIR, 'example_chain.yaml'),
      },
    );
    expect(call).toBe(2);
    expect(result.attempts).toHaveLength(2);
    expect(result.attempts[0].ok).toBe(false);
    expect(result.attempts[1].ok).toBe(true);
    expect(result.spec.phases[0].name).toBe('fixed_phase');
  });

  it('throws SchemaError when both attempts fail validation', async () => {
    const bad = '```yaml\nphases: []\n```';
    const provider: LlmProvider = {
      name: 'fixture',
      complete: vi.fn(async () => ({ raw: bad, provider: 'fixture' as const })),
    };
    await expect(
      scaffoldFromLlm(
        { id: 'twice-bad', title: 'Twice bad', description: 'Both attempts will fail.' },
        {
          providerInstance: provider,
          routerBaseUrl: null,
          cwd: '/tmp',
          grepImpl: async () => [],
          fewShotExamplePath: resolve(FIXTURE_DIR, 'example_chain.yaml'),
        },
      ),
    ).rejects.toBeInstanceOf(SchemaError);
    expect(provider.complete).toHaveBeenCalledTimes(2);
  });

  it('rejects malformed LooseBacklogItem upfront', async () => {
    const provider = makeFixtureProvider('');
    await expect(
      scaffoldFromLlm(
        { id: 'BadId!', title: 'x', description: 'y' },
        { providerInstance: provider, routerBaseUrl: null, cwd: '/tmp', grepImpl: async () => [] },
      ),
    ).rejects.toThrowError(/kebab-case|match/);
  });
});
