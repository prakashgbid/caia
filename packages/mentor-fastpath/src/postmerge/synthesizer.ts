/**
 * Postmerge synthesizer — turn a classified PostMergeInput + event row
 * into a SynthesizedLesson markdown proposal that mirrors the Phase-1
 * `feedback_*.md` shape.
 *
 * Differences from the Phase-1 (operator-correction) synthesizer:
 *
 *   - Source is a structured PR/CI event, not free-form chat text.
 *   - The "Why" section enumerates the structured fields (PR #, SHA,
 *     branch, failed jobs, age) instead of quoting operator text.
 *   - The "How to apply" template is signal-aware — regression-after-
 *     merge maps to a different lesson than evidence-gate-failed.
 *
 * Pure function: no I/O.
 */

import type { SynthesizedLesson } from '../synthesizer.js';
import { slugify } from '../synthesizer.js';
import type {
  ClassificationResult,
  PostMergeEventRow,
  PostMergeInput
} from './types.js';

/**
 * Per-signal "How to apply" guidance template. Distinct from the
 * Phase-1 per-FailureMode templates because the same FailureMode can
 * have multiple signals — e.g. 'PrematureCompletion' arrives via both
 * regression-after-merge (CI red) and post-merge-bug-report (operator).
 */
const HOW_TO_APPLY_BY_SIGNAL: Record<PostMergeInput['signal'], string> = {
  'regression-after-merge':
    "Run the failing job class locally before declaring a PR ready. If it's an integration / e2e job that's expensive locally, at least run the unit test that exercises the same code path. PR-claimed-done while CI is red on the merge commit is a Stage-6 failure of the 6-stage DoD — re-do Stage 6 (test+integrate) before merging anything that touches the same code path.",
  'evidence-gate-failed':
    "Pre-merge gates are the cheapest place to catch slips. Treat any gate failure as a signal to run the *same* check locally before re-pushing. Lint, typecheck, migration-linter all have local-runnable equivalents — surface them in the contributing guide so the next agent doesn't repeat the slip.",
  'post-merge-bug-report':
    "When a bug surfaces after merge, the lesson is in the gap between the test fixture matrix and the real failure mode. Add the missing fixture / scenario to the test suite IN THE SAME PR as the fix, not as a follow-up — follow-ups drift.",
  'pr-merged-only':
    'No action required — this signal is informational only. (If you are seeing this template in a written proposal, the consumer logic that filters Unclassified signals out of the proposals queue is misconfigured.)'
};

/** Build the human-readable proposal title. */
function buildTitle(
  primary: ClassificationResult['primary'],
  input: PostMergeInput
): string {
  const trimmedTitle = (input.title ?? '').trim().replace(/\s+/g, ' ');
  const summary =
    trimmedTitle.length > 0
      ? trimmedTitle.length > 70
        ? `${trimmedTitle.slice(0, 67)}...`
        : trimmedTitle
      : `PR #${input.prNumber}`;
  return `${primary} — ${summary} (${input.signal})`;
}

function renderFrontmatter(fields: Record<string, string>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    const needsQuote = /[:#]/.test(v);
    const escaped = v.replace(/"/g, '\\"').replace(/\n/g, ' ');
    lines.push(`${k}: ${needsQuote ? `"${escaped}"` : escaped}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Build the body's Why section. For postmerge events the "why" is a
 * structured field list, not a quoted text block.
 */
function buildWhy(input: PostMergeInput, classification: ClassificationResult): string {
  const lines: string[] = [];
  lines.push(`- **PR**: #${input.prNumber}${input.title ? ` — ${input.title}` : ''}`);
  lines.push(`- **Branch**: ${input.branch}`);
  if (input.sha) lines.push(`- **SHA**: \`${input.sha}\``);
  if (input.author) lines.push(`- **Author**: @${input.author}`);
  lines.push(`- **Signal**: ${input.signal}`);
  if (input.failedJobs.length > 0) {
    lines.push(`- **Failed jobs**: ${input.failedJobs.map((j) => `\`${j}\``).join(', ')}`);
  }
  if (typeof input.postMergeAgeSec === 'number') {
    const mins = Math.round(input.postMergeAgeSec / 60);
    lines.push(`- **Time post-merge**: ${mins} minute(s) (${input.postMergeAgeSec}s)`);
  }
  if (input.description) {
    const trimmedDesc = input.description.replace(/\s+/g, ' ').trim();
    const desc =
      trimmedDesc.length > 200 ? `${trimmedDesc.slice(0, 197)}...` : trimmedDesc;
    lines.push(`- **Description**: ${desc}`);
  }
  lines.push('');
  lines.push(
    `Classifier flagged this as **${classification.primary}** (severity=${classification.severity}, generalizability=${classification.generalizability}, confidence=${classification.confidence}).`
  );
  return lines.join('\n');
}

/**
 * Synthesize a draft postmerge proposal. Always returns a
 * SynthesizedLesson; never throws.
 *
 * The slug pattern is `<primary>-pr-<num>-<signal>` so repeat signals
 * for the same PR collide deterministically and the memory-writer can
 * dedupe.
 */
export function synthesizePostMerge(
  event: PostMergeEventRow,
  input: PostMergeInput,
  classification: ClassificationResult
): SynthesizedLesson {
  const title = buildTitle(classification.primary, input);
  const slug = slugify(
    `${classification.primary}-pr-${input.prNumber}-${input.signal}`
  );

  const frontmatter: Record<string, string> = {
    name: title,
    description: `Mentor-Phase-2 postmerge proposal from event ${event.id} (PR #${input.prNumber}, ${input.signal})`,
    type: 'feedback-proposal',
    originSessionId: event.correlation_id ?? event.id,
    classifiedAs: classification.primary,
    severity: classification.severity,
    generalizability: classification.generalizability,
    signal: input.signal
  };

  const howToApply = HOW_TO_APPLY_BY_SIGNAL[input.signal];
  const secondaryLine =
    classification.secondary.length > 0
      ? `\n  - Secondary tags: ${classification.secondary.join(', ')}`
      : '';

  const body = `# ${title}

## Why

${buildWhy(input, classification)}

## How to apply

${howToApply}

## Provenance

- Event id: \`${event.id}\`
- Event type: ${event.event_type}
- Emitted at: ${event.emitted_at}
- Hostname: ${event.hostname}
- Process: ${event.process_name ?? '(unknown)'}
- Classifier matched by: \`${classification.matchedBy}\`${secondaryLine}
- Correlation id: ${event.correlation_id ?? '(none)'}

---

*This is a Mentor Phase-2 auto-generated postmerge proposal. An operator review is required before promoting it to \`agent/memory/feedback_*.md\`.*
`;

  const markdown = `${renderFrontmatter(frontmatter)}\n\n${body}`;
  return {
    slug,
    title,
    frontmatter,
    markdown
  };
}
