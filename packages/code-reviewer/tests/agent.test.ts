import { describe, it, expect } from 'vitest';
import { CodeReviewerAgent, runCodeReview } from '../src/agent.js';
import type { FsReader, LlmReviewer, LlmReviewOutput } from '../src/types.js';

const fakeFs = (files: Record<string, string>): FsReader => ({
  exists: (p: string) => Object.prototype.hasOwnProperty.call(files, p),
  readFile: (p: string) => files[p],
  readDir: () => []
});

const fakeLlm = (output: LlmReviewOutput): LlmReviewer => ({
  async review(): Promise<LlmReviewOutput> {
    return output;
  }
});

const SAMPLE_DIFF = [
  'diff --git a/src/foo.ts b/src/foo.ts',
  'index 1234567..abcdefg 100644',
  '--- a/src/foo.ts',
  '+++ b/src/foo.ts',
  '@@ -1,3 +1,4 @@',
  ' export const x = 1;',
  '+export const y = nullableThing.field;',
  ' export const z = 3;',
  ' export const w = 4;'
].join('\n');

describe('CodeReviewerAgent', () => {
  it('returns approve verdict on a clean LLM response', async () => {
    const agent = new CodeReviewerAgent({
      fs: fakeFs({}),
      llm: fakeLlm({ findings: [], ok: true }),
      enableDeterministic: false,
      clock: () => new Date('2026-05-08T00:00:00Z')
    });
    const review = await agent.reviewPR({
      prNumber: 1,
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.verdict).toBe('approve');
    expect(review.findings).toHaveLength(0);
    expect(review.totalFindings).toBe(0);
  });

  it('returns request-changes when LLM finds high-severity issue', async () => {
    const agent = new CodeReviewerAgent({
      fs: fakeFs({}),
      llm: fakeLlm({
        findings: [{
          dimension: 'bug-risk',
          severity: 'high',
          file: 'src/foo.ts',
          line: 2,
          issueTitle: 'null-deref',
          description: 'nullableThing might be null',
          excerpt: 'nullableThing.field'
        }],
        ok: true
      }),
      enableDeterministic: false,
      clock: () => new Date('2026-05-08T00:00:00Z')
    });
    const review = await agent.reviewPR({
      prNumber: 1,
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.verdict).toBe('request-changes');
    expect(review.findings).toHaveLength(1);
    expect(review.blockingFindings).toHaveLength(1);
  });

  it('hallucination guard drops findings with excerpt not in diff', async () => {
    const agent = new CodeReviewerAgent({
      fs: fakeFs({}),
      llm: fakeLlm({
        findings: [{
          dimension: 'bug-risk',
          severity: 'high',
          file: 'src/foo.ts',
          line: 100,
          issueTitle: 'invented',
          description: 'this excerpt is not in the diff',
          excerpt: 'nonexistent_function_call_xyz_12345'
        }],
        ok: true
      }),
      enableDeterministic: false,
      clock: () => new Date('2026-05-08T00:00:00Z')
    });
    const review = await agent.reviewPR({
      prNumber: 1,
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.findings).toHaveLength(0);
    expect(review.verdict).toBe('approve');
  });

  it('passes findings with empty excerpt through hallucination guard', async () => {
    const agent = new CodeReviewerAgent({
      fs: fakeFs({}),
      llm: fakeLlm({
        findings: [{
          dimension: 'naming',
          severity: 'low',
          file: 'src/foo.ts',
          line: 1,
          issueTitle: 'name',
          description: 'd',
          excerpt: ''
        }],
        ok: true
      }),
      enableDeterministic: false,
      clock: () => new Date('2026-05-08T00:00:00Z')
    });
    const review = await agent.reviewPR({
      prNumber: 1,
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.findings).toHaveLength(1);
  });

  it('handles LLM failure gracefully', async () => {
    const failingLlm: LlmReviewer = {
      async review(): Promise<LlmReviewOutput> {
        throw new Error('boom');
      }
    };
    const agent = new CodeReviewerAgent({
      fs: fakeFs({}),
      llm: failingLlm,
      enableDeterministic: false,
      clock: () => new Date('2026-05-08T00:00:00Z')
    });
    const review = await agent.reviewPR({
      prNumber: 1,
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.verdict).toBe('approve');
    expect(review.summary.llmReasoningSucceeded).toBe(false);
  });

  it('disables LLM when configured', async () => {
    const agent = new CodeReviewerAgent({
      fs: fakeFs({}),
      enableLlmReasoning: false,
      enableDeterministic: false
    });
    const review = await agent.reviewPR({
      prNumber: 1,
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(review.summary.llmEnabled).toBe(false);
  });

  it('skips LLM call when diff has no hunks', async () => {
    let called = false;
    const trackingLlm: LlmReviewer = {
      async review(): Promise<LlmReviewOutput> {
        called = true;
        return { findings: [], ok: true };
      }
    };
    const agent = new CodeReviewerAgent({
      fs: fakeFs({}),
      llm: trackingLlm,
      enableDeterministic: false
    });
    await agent.reviewPR({
      prNumber: 1,
      diff: '',
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(called).toBe(false);
  });

  it('loads conventions from configured path', async () => {
    const fs = fakeFs({
      '/repo/AGENTS.md': '## Code style\nUse 2 spaces.'
    });
    let llmInputConventions = 0;
    const trackingLlm: LlmReviewer = {
      async review(input): Promise<LlmReviewOutput> {
        llmInputConventions = input.conventionExcerpts.length;
        return { findings: [], ok: true };
      }
    };
    const agent = new CodeReviewerAgent({
      fs,
      llm: trackingLlm,
      conventionsPath: '/repo/AGENTS.md',
      enableDeterministic: false
    });
    await agent.reviewPR({
      prNumber: 1,
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(llmInputConventions).toBe(1);
  });
});

describe('runCodeReview entrypoint', () => {
  it('forwards args and returns the verdict', async () => {
    const review = await runCodeReview({
      prRef: 42,
      repoPath: '/nonexistent/repo',
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' },
      config: {
        fs: fakeFs({}),
        llm: fakeLlm({ findings: [], ok: true }),
        enableDeterministic: false
      }
    });
    expect(review.verdict).toBe('approve');
    expect(review.prNumber).toBe(42);
  });

  it('handles string prRef by zeroing prNumber', async () => {
    const review = await runCodeReview({
      prRef: 'feat/foo',
      repoPath: '/nonexistent/repo',
      diff: SAMPLE_DIFF,
      context: { branch: 'feat/foo', baseBranch: 'develop', title: 't' },
      config: {
        fs: fakeFs({}),
        llm: fakeLlm({ findings: [], ok: true }),
        enableDeterministic: false
      }
    });
    expect(review.prNumber).toBe(0);
  });

  it('respects config override of conventionsPath', async () => {
    const fs = fakeFs({
      '/explicit/AGENTS.md': '## Code style\nfoo'
    });
    let pathSeen = '';
    const trackingFs: FsReader = {
      exists: (p: string) => { pathSeen = p; return fs.exists(p); },
      readFile: fs.readFile,
      readDir: fs.readDir
    };
    await runCodeReview({
      prRef: 1,
      repoPath: '/repo',
      diff: SAMPLE_DIFF,
      context: { branch: 'b', baseBranch: 'develop', title: 't' },
      config: {
        fs: trackingFs,
        llm: fakeLlm({ findings: [], ok: true }),
        conventionsPath: '/explicit/AGENTS.md',
        enableDeterministic: false
      }
    });
    expect(pathSeen).toBe('/explicit/AGENTS.md');
  });
});
