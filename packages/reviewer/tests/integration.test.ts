/**
 * Integration test — wire the Reviewer end-to-end against a synthetic PR
 * diff containing several craftsmanship issues, with the conventions
 * loader pointed at the fixture AGENTS.md.
 *
 * Verifies:
 *  - Deterministic detectors fire for the expected dimensions.
 *  - LLM tier is invoked exactly once (and stubbed, no real binary).
 *  - LLM finding rides through the merger and is in the output.
 *  - Reviewer's output has no `blockingFindings` field.
 *  - All Reviewer findings' dimensions are disjoint from Critic's denylist.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ReviewerAgent } from '../src/agent.js';
import { CRITIC_DENYLIST } from '../src/types.js';
import type { FsReader, LlmReviewer } from '../src/types.js';

const FIXTURES = join(fileURLToPath(import.meta.url), '..', '__fixtures__');

function loadDiff(name: string): string {
  return readFileSync(join(FIXTURES, 'diffs', name), 'utf-8');
}

const fakeFs: FsReader = {
  exists: (p) => p === join(FIXTURES, 'conventions/mini.md'),
  readFile: (p) => readFileSync(p, 'utf-8'),
  readDir: () => []
};

let llmCallCount = 0;
const stubLlm: LlmReviewer = {
  async review() {
    llmCallCount++;
    return {
      ok: true,
      findings: [{
        dimension: 'idiom-adherence',
        severity: 'consider',
        file: 'packages/example/src/anys.ts',
        line: 2,
        suggestionTitle: 'use-unknown',
        description: 'consider unknown + narrow',
        excerpt: 'export function take(x: any)'
      }]
    };
  }
};

describe('Reviewer integration on synthetic PR', () => {
  it('produces both deterministic and LLM findings, no blocker, no Critic overlap', async () => {
    llmCallCount = 0;
    const agent = new ReviewerAgent({
      conventionsPath: join(FIXTURES, 'conventions/mini.md'),
      fs: fakeFs,
      llm: stubLlm,
      enableLlmReasoning: true
    });
    // Combine multiple dimensions of issues into one PR diff string.
    const combined = [
      loadDiff('type-any.diff'),
      loadDiff('console.diff'),
      loadDiff('comment-density.diff')
    ].join('\n');

    const review = await agent.reviewPR({
      prNumber: 999,
      diff: combined,
      context: { branch: 'feat/integration', baseBranch: 'develop', title: 'integration' }
    });

    expect(llmCallCount).toBe(1);
    expect(review.summary.deterministic).toBeGreaterThan(0);
    expect(review.summary.llmReasoned).toBe(1);
    expect(review.summary.llmEnabled).toBe(true);
    expect(review.summary.llmReasoningSucceeded).toBe(true);
    // Hard invariant: no finding's dimension may be on Critic's denylist.
    for (const f of review.findings) {
      expect(CRITIC_DENYLIST.has(f.dimension)).toBe(false);
    }
    // Hard invariant: Reviewer doesn't emit a blockingFindings field.
    expect((review as unknown as Record<string, unknown>)['blockingFindings']).toBeUndefined();
  });
});
