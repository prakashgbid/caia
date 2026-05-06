/**
 * Integration test — synthetic end-to-end PR review.
 *
 * Wires a complete CriticAgent against the live taxonomy fixture, a real
 * fixture memoryRoot, multiple realistic-shaped diffs, and a stub LLM
 * reasoner. Verifies the full pipeline (parse → detect → llm → merge →
 * report) produces a coherent AdversarialReview.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { CriticAgent } from '../src/agent.js';
import type { LlmReasoner, FsReader } from '../src/types.js';

const FIXTURE_TAXONOMY = resolve(__dirname, '__fixtures__/taxonomy/mini.md');
const FIXTURE_MEMORY = resolve(__dirname, '__fixtures__/memory');
const DIFFS = resolve(__dirname, '__fixtures__/diffs');

const realFs: FsReader = {
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p, 'utf-8'),
  readDir: (p) => existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).sort() : []
};

function loadDiff(name: string): string {
  return readFileSync(join(DIFFS, name), 'utf-8');
}

/** A stub LLM that returns one realistic finding per call so we can verify
 * deterministic + LLM tiers compose correctly through the merger. */
const stubLlm: LlmReasoner = {
  async reason(input) {
    if (input.hunks.length === 0) return { ok: true, findings: [] };
    const first = input.hunks[0]!;
    return {
      ok: true,
      findings: [
        {
          category: 'scope-mismatch',
          severity: 'medium',
          file: first.file,
          line: first.newStart,
          attackVector: 'simulated-llm-finding',
          description: 'Stubbed scope-mismatch finding for integration test verification.',
          reproductionSteps: ['Inspect the change against the PR brief'],
          excerpt: ''
        }
      ]
    };
  }
};

describe('Integration — synthetic PR review', () => {
  it('produces a coherent review for a multi-category PR', async () => {
    // Combine 4 fixture diffs to simulate one PR with several issues.
    const combinedDiff = [
      loadDiff('security-leak.diff'),
      loadDiff('git-hygiene.diff'),
      loadDiff('cost-overrun.diff'),
      loadDiff('decision-classifier.diff')
    ].join('\n');

    const agent = new CriticAgent({
      taxonomyPath: FIXTURE_TAXONOMY,
      memoryRoot: FIXTURE_MEMORY,
      enableLlmReasoning: true,
      fs: realFs,
      llm: stubLlm,
      clock: () => new Date('2026-05-06T00:00:00Z')
    });

    const review = await agent.reviewPR({
      prNumber: 9001,
      diff: combinedDiff,
      context: {
        branch: 'feat/integration-test',
        baseBranch: 'develop',
        title: 'feat: integration synthetic PR',
        commitSubjects: ['feat(integration): synthetic']
      }
    });

    // PR-level invariants
    expect(review.prNumber).toBe(9001);
    expect(review.reviewedAtIso).toBe('2026-05-06T00:00:00.000Z');
    expect(review.totalFindings).toBe(review.findings.length);

    // Severity ordering
    for (let i = 1; i < review.findings.length; i++) {
      const prev = review.findings[i - 1]!;
      const curr = review.findings[i]!;
      const order = { low: 0, medium: 1, high: 2, critical: 3 } as const;
      expect(order[prev.severity]).toBeGreaterThanOrEqual(order[curr.severity]);
    }

    // Required categories surfaced
    const cats = new Set(review.findings.map(f => f.category));
    expect(cats.has('security-regression')).toBe(true);
    expect(cats.has('git-branch-hygiene')).toBe(true);
    expect(cats.has('cost-overrun')).toBe(true);
    expect(cats.has('decision-classifier-violation')).toBe(true);

    // Blocking findings >= high
    const order = { low: 0, medium: 1, high: 2, critical: 3 } as const;
    for (const f of review.blockingFindings) {
      expect(order[f.severity]).toBeGreaterThanOrEqual(order.high);
    }
    // We expect at least the critical (security-regression) and high (cost-overrun, git-hygiene) blocking
    expect(review.blockingFindings.length).toBeGreaterThanOrEqual(3);

    // Summary fields
    expect(review.summary.deterministic).toBeGreaterThan(0);
    expect(review.summary.llmReasoned).toBeGreaterThan(0);
    expect(review.summary.llmEnabled).toBe(true);
    expect(review.summary.llmReasoningSucceeded).toBe(true);
    expect(review.summary.chunksReviewed).toBeGreaterThan(0);
    expect(review.summary.durationMs).toBeGreaterThanOrEqual(0);

    // Every finding carries the required output fields
    for (const f of review.findings) {
      expect(f.id).toMatch(/^crit-/);
      expect(f.detectorId).toBeTruthy();
      expect(f.description.length).toBeGreaterThan(0);
      expect(f.attackVector.length).toBeGreaterThan(0);
      expect(['deterministic', 'llm-reasoned']).toContain(f.source);
    }
  });

  it('returns an empty review for an empty diff', async () => {
    const agent = new CriticAgent({
      taxonomyPath: FIXTURE_TAXONOMY,
      memoryRoot: FIXTURE_MEMORY,
      enableLlmReasoning: false,
      fs: realFs
    });
    const r = await agent.reviewPR({
      prNumber: 0,
      diff: '',
      context: { branch: 'b', baseBranch: 'develop', title: 't' }
    });
    expect(r.totalFindings).toBe(0);
    expect(r.blockingFindings).toHaveLength(0);
  });
});
