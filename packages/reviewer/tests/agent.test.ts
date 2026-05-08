import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReviewerAgent } from '../src/agent.js';
import type { FsReader, LlmReviewer } from '../src/types.js';

const FIXTURES = join(fileURLToPath(import.meta.url), '..', '__fixtures__');

const fakeFs = (files: Record<string, string>): FsReader => ({
  exists: (p) => p in files,
  readFile: (p) => {
    const v = files[p];
    if (v === undefined) throw new Error(`missing ${p}`);
    return v;
  },
  readDir: () => []
});

const noopLlm: LlmReviewer = {
  async review() { return { findings: [], ok: true }; }
};

const stubLlm = (output: Awaited<ReturnType<LlmReviewer['review']>>): LlmReviewer => ({
  async review() { return output; }
});

function loadFixture(name: string): string {
  return readFileSync(join(FIXTURES, 'diffs', name), 'utf-8');
}

describe('ReviewerAgent.reviewPR', () => {
  it('returns 0 findings on a clean diff', async () => {
    const agent = new ReviewerAgent({
      enableLlmReasoning: false,
      conventionsPath: '/none',
      fs: fakeFs({}),
      llm: noopLlm,
      clock: () => new Date('2026-05-06T00:00:00Z')
    });
    const review = await agent.reviewPR({
      prNumber: 1,
      diff: loadFixture('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.totalFindings).toBe(0);
    expect(review.summary.deterministic).toBe(0);
    expect(review.summary.llmEnabled).toBe(false);
  });

  it('combines deterministic findings from a noisy diff', async () => {
    const agent = new ReviewerAgent({
      enableLlmReasoning: false,
      conventionsPath: '/none',
      fs: fakeFs({}),
      llm: noopLlm
    });
    const review = await agent.reviewPR({
      prNumber: 2,
      diff: loadFixture('type-any.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.totalFindings).toBeGreaterThan(0);
    expect(review.findings.every(f => f.source === 'deterministic')).toBe(true);
  });

  it('NEVER produces blocking findings (no blockingFindings field)', async () => {
    const agent = new ReviewerAgent({ enableLlmReasoning: false, fs: fakeFs({}), llm: noopLlm });
    const review = await agent.reviewPR({
      prNumber: 3,
      diff: loadFixture('type-any.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect((review as unknown as Record<string, unknown>)['blockingFindings']).toBeUndefined();
  });

  it('drops LLM finding whose excerpt isn\'t in the diff (hallucination guard)', async () => {
    const agent = new ReviewerAgent({
      enableLlmReasoning: true,
      fs: fakeFs({}),
      llm: stubLlm({
        ok: true,
        findings: [
          {
            dimension: 'idiom-adherence',
            severity: 'consider',
            file: 'imaginary.ts',
            line: 99,
            suggestionTitle: 'fake',
            description: 'd',
            excerpt: 'this string is definitely not in the diff'
          }
        ]
      })
    });
    const review = await agent.reviewPR({
      prNumber: 4,
      diff: loadFixture('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.findings).toHaveLength(0);
  });

  it('keeps LLM findings whose excerpt IS in the diff', async () => {
    const agent = new ReviewerAgent({
      enableLlmReasoning: true,
      fs: fakeFs({}),
      llm: stubLlm({
        ok: true,
        findings: [
          {
            dimension: 'idiom-adherence',
            severity: 'consider',
            file: 'packages/example/src/clean.ts',
            line: 4,
            suggestionTitle: 'real-finding',
            description: 'd',
            excerpt: 'export function describeUser'
          }
        ]
      })
    });
    const review = await agent.reviewPR({
      prNumber: 5,
      diff: loadFixture('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.findings.length).toBe(1);
    expect(review.findings[0]?.source).toBe('llm-reasoned');
  });

  it('marks llmReasoningSucceeded=false when LLM throws', async () => {
    const agent = new ReviewerAgent({
      enableLlmReasoning: true,
      fs: fakeFs({}),
      llm: { async review() { throw new Error('boom'); } }
    });
    const review = await agent.reviewPR({
      prNumber: 6,
      diff: loadFixture('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.summary.llmReasoningSucceeded).toBe(false);
  });
});
