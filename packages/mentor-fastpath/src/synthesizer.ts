/**
 * Synthesizer — turn an OperatorCorrection event + classification into a
 * draft *durable lesson* (a markdown proposal) that mirrors the existing
 * `agent/memory/feedback_*.md` shape used elsewhere in the platform.
 *
 * Phase-1 scope (per `mentor_agent_directive.md` ## Mentor's processing
 * pipeline, step 5 "Synthesize lesson" + step 6 "Distribute"):
 *
 *   - Generate a **proposal** markdown for operator review.
 *   - The proposal is intentionally NOT auto-applied — it lands in
 *     `agent/memory/proposals/` rather than `agent/memory/` root.
 *     Auto-apply gating is a Phase-1 PR-5 concern.
 *
 * The output shape:
 *
 *   ---
 *   name: <human-readable title>
 *   description: <one-line summary>
 *   type: feedback-proposal
 *   originSessionId: <correlation id from the event>
 *   classifiedAs: <FailureMode>
 *   severity: <low|medium|high>
 *   ---
 *
 *   # <Title>
 *
 *   ## Why
 *
 *   <verbatim operator correction text + classifier rationale>
 *
 *   ## How to apply
 *
 *   <category-specific guidance>
 *
 *   ## Provenance
 *
 *   - Event id: <ev_xxx>
 *   - Emitted at: <iso8601>
 *   - Hostname: <host>
 *   - Process: <name>
 *   - Detection mode: <manual|regex|llm>
 *   - Classifier matched by: <regex.source | fallback>
 *
 * Pure function: no I/O. Memory-writer.ts handles the file write.
 */

import type {
  ClassificationResult,
  EventRow,
  FailureMode,
  OperatorCorrectionInput
} from './types.js';

/** The synthesizer output. Memory-writer consumes this directly. */
export interface SynthesizedLesson {
  /** Filename slug — kebab-case, no extension, no leading timestamp. */
  slug: string;
  /** Human-readable title used in the # heading. */
  title: string;
  /** YAML frontmatter as a key/value map. */
  frontmatter: Record<string, string>;
  /** Full markdown body (frontmatter + content), ready to write. */
  markdown: string;
}

/**
 * Per-category "How to apply" guidance template. Keep concise — operator
 * will read these in the proposals queue. The placeholder `{TEXT}` is
 * substituted with the operator's correction text.
 *
 * If a category isn't listed here, a generic fallback template is used.
 */
const HOW_TO_APPLY: Partial<Record<FailureMode, string>> = {
  Hallucination:
    'Before stating a fact about a file/PR/SHA, verify it exists. Use Read or `gh` to confirm. If unsure, say "I haven\'t confirmed this yet" rather than asserting.',
  ScopeMismatch:
    'Re-read the brief before declaring done. If the work delivered diverges from the brief, surface the divergence to the operator before merging.',
  Incompleteness:
    'Apply the 6-stage DoD strictly: analyze → research → solution → implement → test+integrate → test again. Skipping stage 6 (live install rehearsal for daemons / cross-machine work) is the most common cause.',
  WrongDirection:
    'When the approach itself is wrong, stop. Do not patch around it. Re-do stage 1-3 (analyze, research, solution) before resuming implementation.',
  LackingInformation:
    'Before acting, probe context: read the directive, search memory, ask a clarifying question. The cost of probing is much smaller than the cost of redoing work in the wrong direction.',
  CoordinationFailure:
    'Cap concurrent Mac-targeted work at 2 substantial tasks. Use worktrees for any concurrent branches. Snapshot before destructive ops.',
  GitHygieneFailure:
    'PR is not done until merged. Cut from develop, squash-merge, delete branch. Do not leave stash drifting. Do not force-push to develop.',
  CostOverrun:
    'Subscription-only per `feedback_no_api_key_billing.md`. NO TOKEN BUDGETS per `feedback_no_token_budgets.md` — but that is not permission to be wasteful. Continuously route bulk work to Ollama where quality permits.',
  SecurityRegression:
    'Before flagging a credential issue, consult `feedback_pat_topic.md` to avoid re-litigating settled topics. Capability broker gates irreversible actions; do not bypass.',
  OperatorConfusion:
    'When the operator says output was misleading, reword for clarity and verify alignment before continuing. Do not double down.',
  PrematureCompletion:
    'Done means: tests run + green, file actually written, PR actually merged. Verify with the actual tool (Read, `gh pr view`, `pnpm test`) before claiming done.',
  ReLitigation:
    'Search memory first. If `feedback_*.md` exists for the topic, the discussion is settled — do not re-open without explicit operator request.',
  DecisionClassifierViolation:
    'No "want me to / should I / your call" on technical matters. Decide → execute → inform per `feedback_decision_classifier.md`.',
  MemoryDrift:
    'Memory consultation is not optional. Before acting on a topic, search `agent/memory/` for related directives. Cite the file when applying.',
  FalseModesty:
    'Before saying "you have to do this," enumerate at least 3 autonomous alternatives (Keychain, MCP tools, computer-use, scripted CLI, etc.).',
  RecipeRot:
    'When you find the documented procedure no longer matches reality, fix the doc in the same PR as the discovery. Do not just work around it.',
  ToolMisuse:
    'Pick the right tool tier: dedicated MCP > Chrome MCP > computer-use. Use the highest-precision tool available for the task.',
  CIFlakeAsRealFailure:
    'If a test fails intermittently, mark it as flaky and report to Steward. Do not chase a phantom by patching production code.',
  Unclassified:
    'Manual review needed — the classifier did not recognize this correction shape. Add a regex rule to `packages/mentor-fastpath/src/classifier.ts` if this pattern recurs.'
};

/**
 * Generate a kebab-case slug from a free-form title. Used for the
 * proposal filename. Strips non-alphanumerics, collapses whitespace,
 * truncates at 60 chars.
 *
 * Exported for tests + the memory-writer's collision-avoidance logic.
 */
export function slugify(title: string): string {
  const cleaned = title
    .toLowerCase()
    .normalize('NFKD')
    // strip diacritics
    .replace(/[̀-ͯ]/g, '')
    // collapse anything that isn't alnum/space/hyphen to space
    .replace(/[^a-z0-9\s-]/g, ' ')
    // collapse runs of whitespace + hyphens to single hyphen
    .replace(/[\s-]+/g, '-')
    .replace(/^-+|-+$/g, '');
  if (cleaned.length === 0) return 'untitled';
  return cleaned.slice(0, 60).replace(/-+$/, '');
}

/** Render the YAML frontmatter block. */
function renderFrontmatter(fields: Record<string, string>): string {
  const lines = ['---'];
  for (const [k, v] of Object.entries(fields)) {
    // YAML: quote values that contain a colon or hash to avoid surprise
    // parsing as map/comment.
    const needsQuote = /[:#]/.test(v);
    const escaped = v.replace(/"/g, '\\"').replace(/\n/g, ' ');
    lines.push(`${k}: ${needsQuote ? `"${escaped}"` : escaped}`);
  }
  lines.push('---');
  return lines.join('\n');
}

/**
 * Build the human-readable title. Format:
 *   "<Category> — <truncated correction text>"
 * Example:
 *   "ReLitigation — we already decided this"
 */
function buildTitle(
  primary: FailureMode,
  correctionText: string
): string {
  const trimmed = correctionText.trim().replace(/\s+/g, ' ');
  const summary = trimmed.length > 80 ? `${trimmed.slice(0, 77)}...` : trimmed;
  return `${primary} — ${summary}`;
}

/**
 * Synthesize a draft proposal lesson from one classified
 * OperatorCorrection event.
 *
 * Always returns a SynthesizedLesson; never throws. If the input is
 * malformed (empty correctionText), the proposal is still generated with
 * a placeholder body so the operator can see *something* in the queue.
 */
export function synthesize(
  event: EventRow,
  payload: OperatorCorrectionInput,
  classification: ClassificationResult
): SynthesizedLesson {
  const correctionText = (payload.correctionText ?? '').trim();
  const safeText = correctionText.length === 0 ? '(empty correction text)' : correctionText;
  const title = buildTitle(classification.primary, safeText);
  // Slug is built from category + first words of the text — gives
  // operator a recognizable filename when scanning the proposals dir.
  const slug = slugify(`${classification.primary}-${safeText}`);

  const frontmatter: Record<string, string> = {
    name: title,
    description: `Mentor-synthesized proposal from ${event.id} (${classification.primary})`,
    type: 'feedback-proposal',
    originSessionId: event.correlation_id ?? event.id,
    classifiedAs: classification.primary,
    severity: classification.severity,
    generalizability: classification.generalizability
  };

  const howToApply =
    HOW_TO_APPLY[classification.primary] ?? HOW_TO_APPLY.Unclassified ?? '';
  const secondaryLine =
    classification.secondary.length > 0
      ? `\n  - Secondary tags: ${classification.secondary.join(', ')}`
      : '';
  const matchedBy =
    classification.matchedBy === 'fallback' || classification.matchedBy === 'manual-tag'
      ? classification.matchedBy
      : `regex \`${classification.matchedBy}\``;

  const body = `# ${title}

## Why

> ${safeText.split('\n').join('\n> ')}

${
  payload.context
    ? `Context (operator-supplied): ${payload.context.replace(/\s+/g, ' ').trim()}\n\n`
    : ''
}Classifier flagged this as **${classification.primary}** (severity=${classification.severity}, generalizability=${classification.generalizability}, confidence=${classification.confidence}).

## How to apply

${howToApply}

## Provenance

- Event id: \`${event.id}\`
- Emitted at: ${event.emitted_at}
- Hostname: ${event.hostname}
- Process: ${event.process_name ?? '(unknown)'}
- Detection mode: ${payload.detectionMode ?? 'unknown'}
- Classifier matched by: ${matchedBy}${secondaryLine}
- Correlation id: ${event.correlation_id ?? '(none)'}

---

*This is a Mentor Phase-1 auto-generated proposal. An operator review is required before promoting it to \`agent/memory/feedback_*.md\`.*
`;

  const markdown = `${renderFrontmatter(frontmatter)}\n\n${body}`;
  return {
    slug,
    title,
    frontmatter,
    markdown
  };
}
