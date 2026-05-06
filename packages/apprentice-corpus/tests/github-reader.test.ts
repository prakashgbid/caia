import { describe, expect, it } from 'vitest';

import { createGithubReader, formatPrText } from '../src/github-reader.js';
import { createFakeGithub } from './helpers/fakes.js';

describe('formatPrText', () => {
  it('joins title + body', () => {
    expect(formatPrText({
      number: 1,
      title: 'feat: x',
      body: 'body content',
      url: 'http://x',
      mergedAtMs: 0
    })).toBe('feat: x\n\nbody content');
  });
  it('handles empty body', () => {
    expect(formatPrText({
      number: 1,
      title: 'feat: x',
      body: '',
      url: 'http://x',
      mergedAtMs: 0
    })).toBe('feat: x');
  });
  it('returns empty when both blank', () => {
    expect(formatPrText({
      number: 1,
      title: '',
      body: '',
      url: 'http://x',
      mergedAtMs: 0
    })).toBe('');
  });
});

describe('createGithubReader', () => {
  it('emits one artifact per merged PR within window', async () => {
    const now = Date.now();
    const reader = createGithubReader({
      client: createFakeGithub([
        { number: 1, title: 'old', body: 'b', url: 'u', mergedAtMs: now - 1000 * 60 * 60 * 24 * 400 },
        { number: 2, title: 'new', body: 'b', url: 'u', mergedAtMs: now }
      ]),
      repo: 'test/repo'
    });
    const out = await reader.read({ maxAgeDays: 365, nowMs: now });
    expect(out.map((a) => a.sourceId)).toEqual(['pr#2']);
    expect(out[0]?.kind).toBe('PR');
    expect(out[0]?.text).toContain('new');
  });

  it('returns [] on rate limit / failure', async () => {
    const reader = createGithubReader({
      client: {
        async listMergedPrs() {
          throw new Error('rate limited');
        }
      },
      repo: 'test/repo'
    });
    expect(await reader.read({ maxAgeDays: 1, nowMs: Date.now() })).toEqual([]);
  });
});
