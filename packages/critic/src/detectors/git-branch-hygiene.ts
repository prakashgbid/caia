/**
 * git-branch-hygiene detector.
 *
 * Flags references to dangerous git operations in added code, CI, or docs
 * that are NOT explicitly justified with a `# justified:` annotation.
 *
 * Specifically flags: `--force`, `git push --force`, `force-push`,
 * `filter-branch`, `git reset --hard origin`, and bare `gh pr update-branch`
 * (per feedback_pr_update_branch_rebase.md).
 */

import type { Detector } from '../types.js';
import { addedTextOnly, excerpt, makeFinding } from './shared.js';

const DANGEROUS_PATTERNS: { name: string; re: RegExp; mitigation: string }[] = [
  {
    name: 'gh-pr-update-branch',
    re: /\bgh\s+pr\s+update-branch\b/,
    mitigation: 'Per feedback_pr_update_branch_rebase.md, never use `gh pr update-branch`. Use a local rebase + `git push origin "+HEAD:branch"` instead.'
  },
  {
    name: 'git-force-push',
    re: /\bgit\s+push\s+(?:[\w./@:-]+\s+)?(?:--force\b|-f\b)/,
    mitigation: 'Force-push is hook-blocked in this repo. Use `git push origin "+HEAD:branch"` (single + prefix) or rebase then push.'
  },
  {
    name: 'git-filter-branch',
    re: /\bgit\s+filter-(?:branch|repo)\b/,
    mitigation: 'History rewrites must be operator-authorised. If you are squashing a secret-introducing commit, follow feedback_secret_scanner_history_squash.md (soft-reset + delete branch + recreate).'
  },
  {
    name: 'git-reset-hard-origin',
    re: /\bgit\s+reset\s+--hard\s+origin\b/,
    mitigation: 'Hard-reset to origin discards local work. Stash or commit first; verify nothing is lost.'
  }
];

const JUSTIFIED_ANNOTATION = /#\s*justified:/;

export const gitBranchHygieneDetector: Detector = {
  id: 'det-git-branch-hygiene',
  category: 'git-branch-hygiene',
  scan(hunk, _ctx) {
    const findings = [];
    for (const line of addedTextOnly(hunk)) {
      if (JUSTIFIED_ANNOTATION.test(line.text)) continue;
      for (const pat of DANGEROUS_PATTERNS) {
        if (pat.re.test(line.text)) {
          findings.push(makeFinding({
            category: 'git-branch-hygiene',
            file: hunk.file,
            line: line.newLine,
            attackVector: pat.name,
            description: `Dangerous git operation \`${pat.name}\` appears in this change without a \`# justified:\` annotation. Steward will block this on merge.`,
            reproductionSteps: [
              `Open ${hunk.file} at line ${line.newLine}`,
              'Confirm the dangerous git operation is intentional.',
              'If intentional, add a `# justified: <reason>` comment on the same line.'
            ],
            suggestedMitigation: pat.mitigation,
            detectorId: 'det-git-branch-hygiene',
            excerpt: excerpt(line.text)
          }));
        }
      }
    }
    return findings;
  }
};
