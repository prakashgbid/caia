/**
 * Regression tests for false-positive suppression rules added during E2E
 * verification on real CAIA PRs (#374, #368).
 */

import { describe, it, expect } from 'vitest';

import { parseDiff } from '../src/diff-parser.js';
import { costOverrunDetector, incompletenessDetector } from '../src/detectors/index.js';
import type { ScanContext } from '../src/types.js';

const ctx: ScanContext = {
  memoryFiles: [],
  pr: { prNumber: 1, branch: 'b', baseBranch: 'develop', title: 't', commitSubjects: [] },
  reviewedAtIso: '2026-05-06T00:00:00Z'
};

describe('cost-overrun detector — skips test files', () => {
  it('does not flag ANTHROPIC_API_KEY reads in test files', () => {
    const diff = `diff --git a/packages/x/tests/foo.test.ts b/packages/x/tests/foo.test.ts
index 1..2 100644
--- a/packages/x/tests/foo.test.ts
+++ b/packages/x/tests/foo.test.ts
@@ -1 +1,3 @@
+const before = process.env['ANTHROPIC_API_KEY'];
+process.env['ANTHROPIC_API_KEY'] = 'sk-ant-fake';
+process.env['ANTHROPIC_API_KEY'] = before;
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(costOverrunDetector.scan(hunk, ctx)).toHaveLength(0);
  });

  it('does not flag .test.ts at any depth', () => {
    const diff = `diff --git a/packages/x/src/foo.test.ts b/packages/x/src/foo.test.ts
index 1..2 100644
--- a/packages/x/src/foo.test.ts
+++ b/packages/x/src/foo.test.ts
@@ -1 +1,2 @@
+const x = 'https://api.anthropic.com';
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(costOverrunDetector.scan(hunk, ctx)).toHaveLength(0);
  });

  it('still flags non-test source code', () => {
    const diff = `diff --git a/packages/x/src/foo.ts b/packages/x/src/foo.ts
index 1..2 100644
--- a/packages/x/src/foo.ts
+++ b/packages/x/src/foo.ts
@@ -1 +1,2 @@
+const x = 'https://api.anthropic.com';
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(costOverrunDetector.scan(hunk, ctx).length).toBeGreaterThan(0);
  });
});

describe('incompleteness detector — skips markdown files in src/', () => {
  it('does not flag markdown DESIGN.md inside src/', () => {
    const diff = `diff --git a/packages/x/src/backend.DESIGN.md b/packages/x/src/backend.DESIGN.md
new file mode 100644
index 0..1
--- /dev/null
+++ b/packages/x/src/backend.DESIGN.md
@@ -0,0 +1,3 @@
+\`\`\`typescript
+export interface Backend {}
+\`\`\`
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(incompletenessDetector.scan(hunk, ctx)).toHaveLength(0);
  });

  it('still flags real .ts exports in src/', () => {
    const diff = `diff --git a/packages/x/src/api.ts b/packages/x/src/api.ts
index 1..2 100644
--- a/packages/x/src/api.ts
+++ b/packages/x/src/api.ts
@@ -1 +1,2 @@
+export class Foo {}
`;
    const hunk = parseDiff(diff).hunks[0]!;
    expect(incompletenessDetector.scan(hunk, ctx).length).toBeGreaterThan(0);
  });
});
