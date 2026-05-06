import { describe, it, expect } from 'vitest';
import { samplesToJsonl, writeSplitJsonl, toMlxRecord } from '../src/jsonl-formatter.js';
import { fixtureSample } from './helpers/fakes.js';
import { createInMemoryFs } from './helpers/fakes.js';
import type { SplitResult } from '../src/types.js';

describe('toMlxRecord', () => {
  it('strips everything except messages', () => {
    const r = toMlxRecord([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' }
    ]);
    expect(r).toEqual({
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'u' },
        { role: 'assistant', content: 'a' }
      ]
    });
  });
});

describe('samplesToJsonl', () => {
  it('emits one JSON object per line + trailing newline', () => {
    const out = samplesToJsonl([fixtureSample('a'), fixtureSample('b', 'q', 'r')]);
    const lines = out.split('\n');
    // 2 records + empty trailing element from terminating newline
    expect(lines.length).toBe(3);
    expect(lines[lines.length - 1]).toBe('');
    const parsedA = JSON.parse(lines[0]!);
    expect(parsedA).toHaveProperty('messages');
    expect(parsedA).not.toHaveProperty('id');
    expect(parsedA).not.toHaveProperty('meta');
  });

  it('returns empty string for empty input', () => {
    expect(samplesToJsonl([])).toBe('');
  });

  it('preserves message order', () => {
    const out = samplesToJsonl([fixtureSample('x', 'instr', 'resp')]);
    const parsed = JSON.parse(out.split('\n')[0]!);
    expect(parsed.messages[0]).toEqual({ role: 'system', content: 'You are CAIA.' });
    expect(parsed.messages[1]).toEqual({ role: 'user', content: 'instr' });
    expect(parsed.messages[2]).toEqual({ role: 'assistant', content: 'resp' });
  });
});

describe('writeSplitJsonl', () => {
  it('writes train/valid/test files into the work dir', () => {
    const fs = createInMemoryFs();
    fs.mkdir('/work');
    const split: SplitResult = {
      train: [fixtureSample('t1'), fixtureSample('t2')],
      valid: [fixtureSample('v1')],
      test: [fixtureSample('test1')],
      trace: {
        totalSamples: 4,
        holdoutFromManifest: 1,
        holdoutFromIdHash: 0,
        splitSeed: 42,
        fractions: { train: 0.85, valid: 0.1, test: 0.05 }
      }
    };
    const paths = writeSplitJsonl('/work', split, fs);
    expect(paths.trainPath).toBe('/work/train.jsonl');
    expect(paths.validPath).toBe('/work/valid.jsonl');
    expect(paths.testPath).toBe('/work/test.jsonl');
    expect(fs.exists('/work/train.jsonl')).toBe(true);
    expect(fs.exists('/work/valid.jsonl')).toBe(true);
    expect(fs.exists('/work/test.jsonl')).toBe(true);
    expect(fs.readFile('/work/train.jsonl').split('\n').filter(l => l !== '').length).toBe(2);
    expect(fs.readFile('/work/valid.jsonl').split('\n').filter(l => l !== '').length).toBe(1);
    expect(fs.readFile('/work/test.jsonl').split('\n').filter(l => l !== '').length).toBe(1);
  });
});
