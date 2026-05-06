import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { parseDiff } from '../src/diff-parser.js';
import {
  securityRegressionDetector,
  gitBranchHygieneDetector,
  prematureCompletionDetector,
  decisionClassifierDetector,
  reLitigationDetector,
  toolMisuseDetector,
  costOverrunDetector,
  recipeRotDetector,
  falseModestyDetector,
  incompletenessDetector
} from '../src/detectors/index.js';
import type { ScanContext, MemoryFileRef } from '../src/types.js';

function fixture(name: string): string {
  return readFileSync(resolve(__dirname, '__fixtures__/diffs', name), 'utf-8');
}

function ctx(overrides: Partial<ScanContext> = {}): ScanContext {
  return {
    memoryFiles: [],
    pr: { prNumber: 1, branch: 'feat/x', baseBranch: 'develop', title: '', commitSubjects: [] },
    reviewedAtIso: '2026-05-06T00:00:00Z',
    ...overrides
  };
}

describe('securityRegressionDetector', () => {
  it('flags ghp_ literal in non-fixture path', () => {
    const hunk = parseDiff(fixture('security-leak.diff')).hunks[0]!;
    const findings = securityRegressionDetector.scan(hunk, ctx());
    expect(findings).toHaveLength(1);
    expect(findings[0]?.severity).toBe('critical');
    expect(findings[0]?.attackVector).toBe('literal-github-pat');
  });

  it('skips allowlisted fixture paths', () => {
    const hunk = parseDiff(fixture('security-leak.diff')).hunks[0]!;
    const fixtureHunk = { ...hunk, file: 'tests/__fixtures__/secrets.ts' };
    expect(securityRegressionDetector.scan(fixtureHunk, ctx())).toHaveLength(0);
  });

  it('detects multiple credential families', () => {
    const diff = `diff --git a/x.ts b/x.ts
index 1..2 100644
--- a/x.ts
+++ b/x.ts
@@ -1 +1,4 @@
+const k1 = 'sk-abcdefghijklmnopqrstuvwxyz123456';
+const k2 = 'AKIAIOSFODNN7EXAMPLE';
+const k3 = '-----BEGIN RSA PRIVATE KEY-----';
+const k4 = 'eyJabcdefghij.eyJabcdefghij.signature123';
`;
    const hunk = parseDiff(diff).hunks[0]!;
    const findings = securityRegressionDetector.scan(hunk, ctx());
    expect(findings.length).toBeGreaterThanOrEqual(3);
  });
});

describe('gitBranchHygieneDetector', () => {
  it('flags gh pr update-branch and force-push', () => {
    const hunk = parseDiff(fixture('git-hygiene.diff')).hunks[0]!;
    const findings = gitBranchHygieneDetector.scan(hunk, ctx());
    const vectors = findings.map(f => f.attackVector).sort();
    expect(vectors).toEqual(expect.arrayContaining(['gh-pr-update-branch', 'git-force-push']));
  });

  it('skips lines with # justified: annotation', () => {
    const diff = `diff --git a/s.sh b/s.sh
index 1..2 100644
--- a/s.sh
+++ b/s.sh
@@ -1 +1,2 @@
+git push --force origin develop  # justified: emergency revert
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(gitBranchHygieneDetector.scan(hunk, ctx())).toHaveLength(0);
  });
});

describe('prematureCompletionDetector', () => {
  it('flags status:complete in markdown', () => {
    const hunk = parseDiff(fixture('premature-completion.diff')).hunks[0]!;
    const findings = prematureCompletionDetector.scan(hunk, ctx());
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.some(f => f.attackVector === 'markdown-status-claim')).toBe(true);
  });

  it('flags commit subject claiming completion with tiny diff', () => {
    const hunk = parseDiff(fixture('premature-completion.diff')).hunks[0]!;
    const c = ctx({ pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: ['feat: shipped the new thing'] } });
    const findings = prematureCompletionDetector.scan(hunk, c);
    expect(findings.some(f => f.attackVector.includes('completion'))).toBe(true);
  });
});

describe('decisionClassifierDetector', () => {
  it('flags should-i / want-me-to / your-call in markdown', () => {
    const hunk = parseDiff(fixture('decision-classifier.diff')).hunks[0]!;
    const findings = decisionClassifierDetector.scan(hunk, ctx());
    const vectors = findings.map(f => f.attackVector);
    expect(vectors).toContain('option-phrase-should-i');
    expect(vectors).toContain('option-phrase-want-me-to');
    expect(vectors).toContain('option-phrase-your-call');
  });

  it('skips source code (only markdown / comments)', () => {
    const diff = `diff --git a/x.ts b/x.ts
index 1..2 100644
--- a/x.ts
+++ b/x.ts
@@ -1 +1,2 @@
+const should_i = true;
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(decisionClassifierDetector.scan(hunk, ctx())).toHaveLength(0);
  });
});

describe('reLitigationDetector', () => {
  it('flags markdown re-opening a settled topic', () => {
    const hunk = parseDiff(fixture('re-litigation.diff')).hunks[0]!;
    const memoryFiles: MemoryFileRef[] = [
      {
        filename: 'feedback_no_api_key_billing.md',
        topic: 'Subscription only LLM no per-token API key billing',
        bodyExcerpt: 'do not use API keys'
      }
    ];
    const findings = reLitigationDetector.scan(hunk, ctx({ memoryFiles }));
    expect(findings).toHaveLength(1);
    expect(findings[0]?.attackVector).toBe('re-litigation-against-settled-feedback');
  });

  it('does not flag if diff references the feedback file', () => {
    const diff = `diff --git a/p.md b/p.md
new file mode 100644
index 0..1
--- /dev/null
+++ b/p.md
@@ -0,0 +1,2 @@
+# Notes
+See feedback_no_api_key_billing.md for the policy on per-token billing.
`;
    const hunk = parseDiff(diff).hunks[0]!;
    const memoryFiles: MemoryFileRef[] = [
      { filename: 'feedback_no_api_key_billing.md', topic: 'subscription only LLM no per-token billing', bodyExcerpt: '' }
    ];
    expect(reLitigationDetector.scan(hunk, ctx({ memoryFiles }))).toHaveLength(0);
  });
});

describe('toolMisuseDetector', () => {
  it('flags raw fetch http in source', () => {
    const hunk = parseDiff(fixture('tool-misuse.diff')).hunks[0]!;
    const findings = toolMisuseDetector.scan(hunk, ctx());
    expect(findings.length).toBeGreaterThan(0);
    expect(findings[0]?.attackVector).toBe('raw-http-call-instead-of-mcp');
  });

  it('respects // tool-misuse: allow', () => {
    const diff = `diff --git a/x.ts b/x.ts
index 1..2 100644
--- a/x.ts
+++ b/x.ts
@@ -1 +1,2 @@
+const r = await fetch('https://api.example.com'); // tool-misuse: allow
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(toolMisuseDetector.scan(hunk, ctx())).toHaveLength(0);
  });
});

describe('costOverrunDetector', () => {
  it('flags api.anthropic.com + ANTHROPIC_API_KEY reads', () => {
    const hunk = parseDiff(fixture('cost-overrun.diff')).hunks[0]!;
    const findings = costOverrunDetector.scan(hunk, ctx());
    expect(findings.length).toBeGreaterThanOrEqual(2);
    expect(findings.some(f => f.attackVector.includes('per-token-host'))).toBe(true);
    expect(findings.some(f => f.attackVector === 'reads-anthropic-api-key')).toBe(true);
  });
});

describe('recipeRotDetector', () => {
  it('flags new doc referencing project path with cat verb', () => {
    const hunk = parseDiff(fixture('recipe-rot.diff')).hunks[0]!;
    const findings = recipeRotDetector.scan(hunk, ctx());
    expect(findings.length).toBeGreaterThan(0);
  });
});

describe('falseModestyDetector', () => {
  it('flags unjustified "I cannot"', () => {
    const hunk = parseDiff(fixture('false-modesty.diff')).hunks[0]!;
    const findings = falseModestyDetector.scan(hunk, ctx());
    expect(findings).toHaveLength(1);
  });

  it('skips when justification keyword present', () => {
    const diff = `diff --git a/r.md b/r.md
index 1..2 100644
--- a/r.md
+++ b/r.md
@@ -1 +1,2 @@
+I cannot do this because the capability-broker prohibits credential entry.
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(falseModestyDetector.scan(hunk, ctx())).toHaveLength(0);
  });
});

describe('incompletenessDetector', () => {
  it('flags new exports', () => {
    const hunk = parseDiff(fixture('incompleteness.diff')).hunks[0]!;
    const findings = incompletenessDetector.scan(hunk, ctx());
    expect(findings.length).toBeGreaterThanOrEqual(2); // class + function
  });

  it('only fires on src/ paths', () => {
    const diff = `diff --git a/scripts/run.ts b/scripts/run.ts
index 1..2 100644
--- a/scripts/run.ts
+++ b/scripts/run.ts
@@ -1 +1,2 @@
+export const X = 1;
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(incompletenessDetector.scan(hunk, ctx())).toHaveLength(0);
  });
});
