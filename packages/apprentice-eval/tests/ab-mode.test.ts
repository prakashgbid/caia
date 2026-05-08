import { describe, expect, it } from 'vitest';

import { __TEST_ONLY, runAbMode } from '../src/ab-mode.js';
import { createFakeOllama, InMemoryFs } from './helpers/fakes.js';
import type { PromptSuite } from '../src/types.js';

describe('sample (deterministic)', () => {
  it('returns all elements when n ≥ length', () => {
    const arr = ['a', 'b', 'c'];
    expect(__TEST_ONLY.sample(arr, 5, 1, __TEST_ONLY.defaultRandom)).toEqual(arr);
  });

  it('returns deterministic sample for the same seed', () => {
    const arr = Array.from({ length: 20 }, (_, i) => `e${i}`);
    const s1 = __TEST_ONLY.sample(arr, 5, 42, __TEST_ONLY.defaultRandom);
    const s2 = __TEST_ONLY.sample(arr, 5, 42, __TEST_ONLY.defaultRandom);
    expect(s1).toEqual(s2);
    expect(new Set(s1).size).toBe(5);
  });

  it('different seeds produce different samples', () => {
    const arr = Array.from({ length: 20 }, (_, i) => `e${i}`);
    const s1 = __TEST_ONLY.sample(arr, 5, 1, __TEST_ONLY.defaultRandom);
    const s2 = __TEST_ONLY.sample(arr, 5, 999, __TEST_ONLY.defaultRandom);
    expect(s1).not.toEqual(s2);
  });
});

describe('runAbMode', () => {
  it('runs ollama for each pair, captures preference, writes JSONL', async () => {
    const suite: PromptSuite = {
      id: 's',
      description: 'd',
      sourcePath: '/s.yaml',
      tests: [
        { id: 'p1', description: 'd', vars: { prompt: 'q1' }, assert: [] },
        { id: 'p2', description: 'd', vars: { prompt: 'q2' }, assert: [] }
      ]
    };
    const ollama = createFakeOllama();
    const fs = new InMemoryFs();
    const calls: string[] = [];
    const result = await runAbMode({
      suite,
      adapter: { name: 'a', kind: 'm', path: '/p' },
      baseModel: 'm',
      pairs: 2,
      seed: 7,
      outputDir: '/out',
      ollama,
      writer: fs,
      clock: () => new Date('2026-05-06T00:00:00Z'),
      prompter: async ({ promptId }) => {
        calls.push(promptId);
        return { preference: 'A' };
      }
    });
    expect(result.records).toHaveLength(2);
    expect(calls).toHaveLength(2);
    expect(result.outputPath).toBe('/out/ab-preferences.jsonl');
    const body = await fs.readFile(result.outputPath);
    expect(body.split('\n').filter(Boolean)).toHaveLength(2);
  });
});
