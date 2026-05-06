/**
 * premature-completion detector.
 *
 * Flags commit-message subjects (and PR titles in the diff body) that claim
 * "complete / done / shipped / finished" when the actual diff is small enough
 * that the claim is suspicious. Threshold: < 50 lines added.
 *
 * Also flags markdown files (CHANGELOG, README) that add a "✅ DONE" or
 * `Status: complete` line in the same PR — Mentor's most-frequent class.
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

const SUBJECT_CLAIMS = /\b(complete|completed|done|shipped|ready|finished|landed)\b/i;
const STATUS_CLAIM = /\bStatus\s*[:=]\s*(complete|done|shipped|ready)\b/i;
const CHECKMARK_CLAIM = /✅.{0,20}\b(done|complete|shipped|ready)\b/i;

const SMALL_DIFF_LINE_THRESHOLD = 50;

export const prematureCompletionDetector: Detector = {
  id: 'det-premature-completion',
  category: 'premature-completion',
  scan(hunk, ctx) {
    const findings = [];

    // 1. PR title / commit subjects — only check these once per PR (we'll
    // emit findings against the first hunk only; cross-hunk dedup makes
    // duplicates safe but wasteful).
    const totalAddedLines = addedTextOnly(hunk).length;

    if (ctx.pr.commitSubjects.length > 0 && totalAddedLines < SMALL_DIFF_LINE_THRESHOLD) {
      for (const subject of ctx.pr.commitSubjects) {
        if (SUBJECT_CLAIMS.test(subject)) {
          findings.push(makeFinding({
            category: 'premature-completion',
            file: hunk.file,
            line: 0,
            attackVector: 'commit-claims-completion-with-tiny-diff',
            description: `Commit subject "${subject.slice(0, 80)}" claims completion, but this PR adds only ${totalAddedLines} lines. Premature-completion is the most-frequent Mentor classification — every "done" claim must be backed by passing tests + DoD evidence.`,
            reproductionSteps: [
              `git log --oneline ${ctx.pr.baseBranch}..HEAD`,
              'Cross-check whether tests for the new behaviour exist.',
              `If they don't: the "${subject.match(SUBJECT_CLAIMS)?.[0] ?? 'completion'}" claim is premature.`
            ],
            suggestedMitigation: 'Add a verification step in the DoD that proves the claimed completion (test run output, screenshot, or manifest hash).',
            detectorId: 'det-premature-completion',
            excerpt: excerpt(subject)
          }));
          break; // one finding per PR is enough
        }
      }
    }

    // 2. Status-line claims in markdown
    if (/\.(md|mdx|markdown)$/i.test(hunk.file)) {
      for (const line of addedTextOnly(hunk)) {
        if (STATUS_CLAIM.test(line.text) || CHECKMARK_CLAIM.test(line.text)) {
          findings.push(makeFinding({
            category: 'premature-completion',
            file: hunk.file,
            line: line.newLine,
            attackVector: 'markdown-status-claim',
            description: 'Documentation marks status as "complete" / "done" / "shipped". Verify the underlying work actually meets DoD before merging.',
            reproductionSteps: [
              `cat ${hunk.file}`,
              'Cross-check the status claim against actual evidence (CI run, test output, deployed artifact).'
            ],
            suggestedMitigation: 'Reference the verification artifact (PR #, CI run URL, test fixture path) on the same line as the status claim.',
            detectorId: 'det-premature-completion',
            excerpt: excerpt(line.text)
          }));
        }
      }
    }

    return findings;
  }
};
