/**
 * Curator Phase-2 — finding-to-action classifier.
 *
 * Pure function: given a list of `Finding`s (from a Phase-1 scan run),
 * decide which ones warrant escalation to one of the directive's
 * output modes 5–8 and emit the corresponding `Action` objects.
 *
 * Routing rules (deliberately conservative — false positives waste
 * operator review time):
 *
 *   - severity: 'critical'                        → alarm  (output mode 7)
 *   - severity: 'high'   + effort: trivial|small  → pr-proposal (mode 5)
 *   - severity: 'high'   + effort: medium|large|xlarge → backlog-directive (mode 6)
 *   - severity: 'medium' + effort: trivial         → pr-proposal (mode 5)
 *   - severity: 'medium' + effort: small|medium    → backlog-directive (mode 6)
 *   - severity: 'medium' + effort: large|xlarge    → backlog-directive (mode 6)
 *   - severity: 'low' / 'info'                     → no action (digest only)
 *
 * Industry-briefings do NOT come from Findings — they're emitted by
 * the watchlist scanner in PR-3 and surface through `actionsFromWatchlist`
 * (added in PR-3). The classifier only handles the finding-driven
 * three.
 *
 * Slug computation: scannerId + slugified-title, truncated to keep
 * filenames <100 chars. Identical findings across multiple runs map
 * to identical slugs (idempotency boundary).
 */

import type { Finding } from '../types.js';
import type {
  Action,
  AlarmAction,
  BacklogDirectiveAction,
  PrProposalAction
} from './types.js';

const SLUG_MAX_LEN = 80;

/**
 * Slugify free-form text → kebab-case identifier suitable for a
 * filename. Lowercases, replaces non-alphanumeric runs with `-`,
 * collapses dashes, trims, and truncates.
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX_LEN);
}

/**
 * Build a stable slug for an action derived from a Finding. Uses
 * `<scannerId>-<title-slug>` so multiple findings from the same
 * scanner stay distinguishable but identical findings collapse to
 * one file.
 */
export function actionSlugForFinding(f: Finding): string {
  const scannerSlug = slugify(f.scannerId);
  const titleSlug = slugify(f.title);
  const combined = `${scannerSlug}-${titleSlug}`;
  return combined.slice(0, SLUG_MAX_LEN);
}

/**
 * Build the recommendation text used in an action body. Defaults to
 * the finding's `recommendation`; falls back to a generic prompt if
 * that field is empty.
 */
function recommendationFor(f: Finding): string {
  const trimmed = f.recommendation.trim();
  return trimmed.length > 0
    ? trimmed
    : 'Investigate, decide on remediation, and either open a PR or file a deferral note.';
}

/**
 * Map a Finding to its summary paragraph used in the rendered action.
 * Just the finding's `detail` + a one-line provenance footer.
 */
function summaryFor(f: Finding): string {
  const detail = f.detail.trim();
  const provenance = `Surfaced by Curator scanner \`${f.scannerId}\` on ${f.detectedAt}.`;
  return detail.length > 0 ? `${detail}\n\n${provenance}` : provenance;
}

/**
 * Pure function: given a list of `Finding`s, decide which ones
 * escalate and return the corresponding `Action`s. Findings that
 * don't escalate are simply omitted (no `null`s, no errors).
 *
 * Multiple findings that map to the same slug collapse into a single
 * Action whose `sourceFindings` lists all original `scannerId`s and
 * whose `evidence` is the concatenation. This makes the function
 * idempotent on the slug axis: re-running on the same input emits
 * the same Action set.
 */
export function findingsToActions(findings: Finding[]): Action[] {
  // Group findings by (kind, slug) so duplicates collapse.
  const buckets = new Map<string, { kind: Action['kind']; group: Finding[] }>();

  for (const f of findings) {
    const kind = classifyKind(f);
    if (kind === null) continue;
    const slug = actionSlugForFinding(f);
    const key = `${kind}:${slug}`;
    let entry = buckets.get(key);
    if (entry === undefined) {
      entry = { kind, group: [] };
      buckets.set(key, entry);
    }
    entry.group.push(f);
  }

  const actions: Action[] = [];
  for (const { kind, group } of buckets.values()) {
    const lead = group[0]!;
    const slug = actionSlugForFinding(lead);
    const sourceFindings = Array.from(new Set(group.map((g) => g.scannerId)));
    const evidence = dedupe(group.flatMap((g) => g.evidence));
    const summary = summaryFor(lead);
    const recommendation = recommendationFor(lead);

    if (kind === 'alarm') {
      // Alarms only emit for critical / high severities — guarded by
      // the kind classifier above, but the type narrowing happens here.
      if (lead.severity !== 'critical' && lead.severity !== 'high') continue;
      const action: AlarmAction = {
        kind: 'alarm',
        slug,
        title: lead.title,
        sourceFindings,
        summary,
        evidence,
        recommendation,
        detectedAt: lead.detectedAt,
        severity: lead.severity,
        dimension: lead.dimension
      };
      actions.push(action);
      continue;
    }

    if (kind === 'pr-proposal') {
      const branchSuffix = `${slug}`.slice(0, 60);
      const action: PrProposalAction = {
        kind: 'pr-proposal',
        slug,
        title: lead.title,
        sourceFindings,
        summary,
        evidence,
        recommendation,
        detectedAt: lead.detectedAt,
        branchSuffix,
        affectedPaths: []
      };
      actions.push(action);
      continue;
    }

    if (kind === 'backlog-directive') {
      const action: BacklogDirectiveAction = {
        kind: 'backlog-directive',
        slug,
        title: lead.title,
        sourceFindings,
        summary,
        evidence,
        recommendation,
        detectedAt: lead.detectedAt,
        dimension: lead.dimension,
        effortEstimate:
          lead.effort === 'trivial' ? 'small' : (lead.effort as
            | 'small'
            | 'medium'
            | 'large'
            | 'xlarge')
      };
      actions.push(action);
      continue;
    }
  }

  // Sort: alarms first (urgency), then pr-proposals (cheap wins),
  // then backlog-directives. Stable ordering for the consumer.
  return actions.sort((a, b) => kindOrder(a.kind) - kindOrder(b.kind));
}

/**
 * Decide which output-mode kind a Finding maps to, or `null` if it
 * doesn't escalate.
 *
 * Exported for direct unit testing of routing rules.
 */
export function classifyKind(f: Finding): Action['kind'] | null {
  if (f.severity === 'critical') return 'alarm';
  if (f.severity === 'high') {
    if (f.effort === 'trivial' || f.effort === 'small') return 'pr-proposal';
    return 'backlog-directive';
  }
  if (f.severity === 'medium') {
    if (f.effort === 'trivial') return 'pr-proposal';
    return 'backlog-directive';
  }
  return null; // low + info → digest only
}

function kindOrder(kind: Action['kind']): number {
  switch (kind) {
    case 'alarm':
      return 0;
    case 'pr-proposal':
      return 1;
    case 'backlog-directive':
      return 2;
    case 'industry-briefing':
      return 3;
  }
}

function dedupe(arr: string[]): string[] {
  return Array.from(new Set(arr));
}
