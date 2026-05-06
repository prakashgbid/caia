import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';

import { CriticAgent } from '../src/agent.js';
import type { LlmReasoner, FsReader } from '../src/types.js';

const FIXTURE_TAXONOMY = resolve(__dirname, '__fixtures__/taxonomy/mini.md');
const FIXTURE_MEMORY = resolve(__dirname, '__fixtures__/memory');
const DIFFS = resolve(__dirname, '__fixtures__/diffs');

const noopLlm: LlmReasoner = {
  async reason() { return { ok: true, findings: [] }; }
};

// Real fs reader that just delegates to node:fs synchronous calls.
const realFs: FsReader = {
  exists: (p) => existsSync(p),
  readFile: (p) => readFileSync(p, 'utf-8'),
  readDir: (p) => existsSync(p) && statSync(p).isDirectory() ? readdirSync(p).sort() : []
};

function loadDiff(name: string): string {
  return readFileSync(join(DIFFS, name), 'utf-8');
}

function makeAgent(overrides: Partial<ConstructorParameters<typeof CriticAgent>[0]> = {}): CriticAgent {
  return new CriticAgent({
    taxonomyPath: FIXTURE_TAXONOMY,
    memoryRoot: FIXTURE_MEMORY,
    enableLlmReasoning: false,
    fs: realFs,
    llm: noopLlm,
    clock: () => new Date('2026-05-06T00:00:00Z'),
    ...overrides
  });
}

describe('CriticAgent.reviewPR', () => {
  it('finds the security-regression fixture', async () => {
    const agent = makeAgent();
    const r = await agent.reviewPR({
      prNumber: 999,
      diff: loadDiff('security-leak.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(r.totalFindings).toBeGreaterThan(0);
    expect(r.findings.some(f => f.category === 'security-regression')).toBe(true);
    expect(r.blockingFindings.length).toBeGreaterThan(0);
  });

  it('returns no findings for a clean diff with tests', async () => {
    const agent = makeAgent();
    const r = await agent.reviewPR({
      prNumber: 1,
      diff: loadDiff('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 'feat: add util' }
    });
    expect(r.findings).toHaveLength(0);
    expect(r.blockingFindings).toHaveLength(0);
  });

  it('catches multiple categories in one PR', async () => {
    const combined = loadDiff('git-hygiene.diff') + '\n' + loadDiff('cost-overrun.diff');
    const agent = makeAgent();
    const r = await agent.reviewPR({
      prNumber: 2,
      diff: combined,
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    const cats = new Set(r.findings.map(f => f.category));
    expect(cats.has('git-branch-hygiene')).toBe(true);
    expect(cats.has('cost-overrun')).toBe(true);
  });

  it('respects severityFloor=critical', async () => {
    const agent = makeAgent({ severityFloor: 'critical' });
    const r = await agent.reviewPR({
      prNumber: 3,
      diff: loadDiff('decision-classifier.diff'), // medium-severity findings
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(r.findings).toHaveLength(0);
  });

  it('records summary fields', async () => {
    const agent = makeAgent();
    const r = await agent.reviewPR({
      prNumber: 4,
      diff: loadDiff('security-leak.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(r.summary.chunksReviewed).toBeGreaterThan(0);
    expect(r.summary.deterministic).toBeGreaterThan(0);
    expect(r.summary.llmEnabled).toBe(false);
    expect(r.summary.llmReasoningSucceeded).toBe(true);
  });

  it('skips llm tier when disabled and produces deterministic-only findings', async () => {
    const agent = makeAgent({ enableLlmReasoning: false });
    const r = await agent.reviewPR({
      prNumber: 5,
      diff: loadDiff('security-leak.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(r.summary.llmReasoned).toBe(0);
    expect(r.findings.every(f => f.source === 'deterministic')).toBe(true);
  });

  it('hydrates llm-reasoned findings via injected reasoner', async () => {
    const fakeLlm: LlmReasoner = {
      async reason() {
        return {
          ok: true,
          findings: [
            {
              category: 'hallucination',
              severity: 'high',
              file: 'foo.ts',
              line: 99,
              attackVector: 'fake-claim',
              description: 'pretends a function exists',
              reproductionSteps: ['look at line 99'],
              excerpt: ''
            }
          ]
        };
      }
    };
    const agent = makeAgent({ enableLlmReasoning: true, llm: fakeLlm });
    const r = await agent.reviewPR({
      prNumber: 6,
      diff: loadDiff('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(r.findings.some(f => f.source === 'llm-reasoned')).toBe(true);
  });

  it('drops llm findings whose excerpt is not in the diff (hallucination guard)', async () => {
    const fakeLlm: LlmReasoner = {
      async reason() {
        return {
          ok: true,
          findings: [
            {
              category: 'hallucination',
              severity: 'high',
              file: 'foo.ts',
              line: 99,
              attackVector: 'fake',
              description: 'd',
              reproductionSteps: [],
              excerpt: 'this string is definitely not in any diff anywhere XYZ123'
            }
          ]
        };
      }
    };
    const agent = makeAgent({ enableLlmReasoning: true, llm: fakeLlm });
    const r = await agent.reviewPR({
      prNumber: 7,
      diff: loadDiff('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(r.findings.filter(f => f.source === 'llm-reasoned')).toHaveLength(0);
  });

  it('catches premature-completion via commit subjects', async () => {
    const agent = makeAgent();
    const r = await agent.reviewPR({
      prNumber: 8,
      diff: loadDiff('clean.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't', commitSubjects: ['feat: shipped the new feature'] }
    });
    expect(r.findings.some(f => f.category === 'premature-completion')).toBe(true);
  });

  it('detects re-litigation when memory file matches', async () => {
    const agent = makeAgent();
    const r = await agent.reviewPR({
      prNumber: 9,
      diff: loadDiff('re-litigation.diff'),
      context: { branch: 'feat/x', baseBranch: 'develop', title: 't' }
    });
    expect(r.findings.some(f => f.category === 're-litigation')).toBe(true);
  });

  it('caches taxonomy across reviews', async () => {
    let reads = 0;
    const fs: FsReader = {
      exists: (p) => existsSync(p),
      readFile: (p) => { if (p === FIXTURE_TAXONOMY) reads++; return readFileSync(p, 'utf-8'); },
      readDir: realFs.readDir
    };
    const agent = makeAgent({ fs, enableLlmReasoning: true, llm: { async reason() { return { ok: true, findings: [] }; } } });
    await agent.reviewPR({ prNumber: 10, diff: loadDiff('clean.diff'), context: { branch: 'b', baseBranch: 'develop', title: 't' } });
    await agent.reviewPR({ prNumber: 11, diff: loadDiff('clean.diff'), context: { branch: 'b', baseBranch: 'develop', title: 't' } });
    expect(reads).toBeLessThanOrEqual(1);
  });

  it('suppresses incompleteness when PR touches tests/ paths', async () => {
    const combined = loadDiff('incompleteness.diff') + `
diff --git a/packages/sample/tests/api.test.ts b/packages/sample/tests/api.test.ts
new file mode 100644
index 0..1
--- /dev/null
+++ b/packages/sample/tests/api.test.ts
@@ -0,0 +1,2 @@
+import { helperFn } from '../src/api.js';
+test('h', () => expect(helperFn(1)).toBe(2));
`;
    const agent = makeAgent();
    const r = await agent.reviewPR({
      prNumber: 12,
      diff: combined,
      context: { branch: 'b', baseBranch: 'develop', title: 't' }
    });
    expect(r.findings.filter(f => f.category === 'incompleteness')).toHaveLength(0);
  });

  it('handles llm-tier exceptions without crashing', async () => {
    const throwingLlm: LlmReasoner = {
      async reason() { throw new Error('boom'); }
    };
    const agent = makeAgent({ enableLlmReasoning: true, llm: throwingLlm });
    const r = await agent.reviewPR({
      prNumber: 13,
      diff: loadDiff('clean.diff'),
      context: { branch: 'b', baseBranch: 'develop', title: 't' }
    });
    expect(r.summary.llmReasoningSucceeded).toBe(false);
  });
});
