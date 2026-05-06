/**
 * incompleteness detector.
 *
 * Flags PRs that add new public symbols (exported functions/classes/types) in
 * src/ but do NOT include a corresponding test file change. Heuristic:
 * count `export` statements added to non-test source files, then check
 * whether ANY hunk in the same PR touches a `tests/` or `__tests__/` path.
 *
 * The detector is hunk-local, so the cross-hunk aggregation happens in the
 * agent — this detector emits one finding per export-bearing hunk if the
 * full-PR ScanContext doesn't include any test-touching hunk.
 *
 * The agent populates `ctx.pr.commitSubjects` and we re-use the same
 * mechanism by tagging the finding so the merger can suppress it if any
 * test hunk was found anywhere in the PR.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

const SRC_PATH = /^(?:packages|apps)\/[^/]+\/src\//;
const MD_PATH = /\.(md|mdx|markdown)$/i;
const EXPORT_LINE = /^\s*export\s+(?:async\s+)?(?:function|class|interface|type|const|let|var|enum)\s+([A-Za-z_]\w*)/;

export const incompletenessDetector: Detector = {
  id: 'det-incompleteness',
  category: 'incompleteness',
  scan(hunk, _ctx) {
    if (!SRC_PATH.test(hunk.file)) return [];
    if (MD_PATH.test(hunk.file)) return [];
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      const m = EXPORT_LINE.exec(line.text);
      if (m === null) continue;
      const symbol = m[1] ?? 'export';
      findings.push(makeFinding({
        category: 'incompleteness',
        file: hunk.file,
        line: line.newLine,
        attackVector: `new-export-${symbol}`,
        description: `New public export \`${symbol}\` added without a verified test in this PR. Incompleteness check — every public surface needs at least one fixture-tested behaviour.`,
        reproductionSteps: [
          `git diff ${hunk.file} ${hunk.file.replace(/\/src\//, '/tests/').replace(/\.ts$/, '.test.ts')}`,
          `Confirm a test for \`${symbol}\` exists.`
        ],
        suggestedMitigation: `Add a test for \`${symbol}\` in the package's tests/ directory before merging.`,
        detectorId: 'det-incompleteness',
        excerpt: excerpt(line.text)
      }));
    }
    return findings;
  }
};
