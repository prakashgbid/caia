/**
 * Mentor Phase-4 PR-3 — quarterly self-review.
 *
 * The directive (`mentor_agent_directive.md` ## Phase 4) mandates a
 * "Quarterly self-review of Mentor's own track record". This module
 * produces a deterministic markdown report that aggregates:
 *
 *   - Index health (totals by kind; build freshness; oversize-file
 *     failure rate via reading the index meta keys).
 *   - Incident volume by classification across the rolling window.
 *   - Top systemic clusters by occurrence count.
 *   - Steward-rule proposal coverage — how many systemic clusters
 *     already have a written `steward-rule-*.md` proposal sitting in
 *     `<memoryDir>/proposals/` for operator review.
 *   - Sustained vs burst breakdown.
 *
 * The default window is 90 days (≈ one quarter). Operators can
 * shorten it for weekly health-checks or extend for year-over-year
 * comparisons via the `--window-days` flag on the CLI.
 *
 * Why a self-review at all
 *
 * Phase-4 PR-1 + PR-2 add machinery that promotes systemic patterns
 * into Steward-rule proposals. Without a self-review the operator
 * has no easy way to answer:
 *
 *   - Are the lessons actually accumulating? (index-growth signal)
 *   - Are the same patterns still recurring after Steward rules
 *     were proposed? (effectiveness signal)
 *   - Is Mentor classifying everything, or are unclassified
 *     proposals piling up? (taxonomy-coverage signal)
 *
 * This file is the operator's quarterly answer.
 *
 * Like the rest of mentor-retrieval, the public surface is
 * pure-function: `generateSelfReview` takes lessons + an opts bag
 * and returns a `SelfReviewSnapshot`; `renderSelfReviewMarkdown`
 * turns the snapshot into the markdown the CLI writes.
 */

import { existsSync, readdirSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';

import { clusterProposals, type Cluster } from './cluster.js';
import type { IndexedLesson } from './types.js';

/** Default window for the self-review (≈ a quarter). */
export const DEFAULT_WINDOW_DAYS = 90;

/** How many top systemic clusters to highlight in the markdown. */
export const DEFAULT_TOP_CLUSTERS = 10;

export interface SelfReviewOptions {
  /** ms since epoch — defaults to Date.now(). Tests inject. */
  nowMs?: number;
  /** Default DEFAULT_WINDOW_DAYS. */
  windowDays?: number;
  /** Default DEFAULT_TOP_CLUSTERS. */
  topClustersToHighlight?: number;
  /** Default DEFAULT_SYSTEMIC_THRESHOLD (3) via the cluster module. */
  systemicThreshold?: number;
  /**
   * Optional lookup for whether a Steward-rule proposal file already
   * exists for `(classification, topicSlug)`. Defaults to a real-FS
   * scanner against `<memoryDir>/proposals/steward-rule-*.md`.
   */
  ruleProposalIndex?: Set<string>;
  /** memoryDir — required for the default ruleProposalIndex lookup. */
  memoryDir?: string;
  /** Index meta — passes through `lastBuildAtIso` etc. */
  meta?: SelfReviewMetaInput | undefined;
}

export interface SelfReviewMetaInput {
  embeddingModel: string | null;
  embeddingDim: number | null;
  lastBuildAtMs: number | null;
  lastBuildScanned: number | null;
}

export interface ClassificationBreakdownRow {
  classification: string;
  totalCount: number;
  withinWindowCount: number;
}

export interface TopClusterRow {
  classification: string;
  topicSlug: string;
  occurrenceCount: number;
  firstSeenIso: string;
  lastSeenIso: string;
  burst: boolean;
  hasStewardRuleProposal: boolean;
}

export interface SelfReviewSnapshot {
  generatedAtIso: string;
  windowDays: number;
  windowStartIso: string;
  windowEndIso: string;

  // Index health
  totalLessons: number;
  feedbackCount: number;
  proposalCount: number;
  embeddingModel: string | null;
  embeddingDim: number | null;
  lastBuildAtIso: string | null;
  lastBuildScanned: number | null;

  // Volume within window
  proposalsWithinWindow: number;
  classificationBreakdown: ClassificationBreakdownRow[];

  // Cluster shape
  totalClusters: number;
  systemicClusterCount: number;
  oneOffClusterCount: number;
  burstClusterCount: number;
  sustainedSystemicCount: number;

  // Steward-rule coverage
  stewardRuleProposalsOnDisk: number;
  systemicClustersWithRuleProposal: number;
  systemicClustersWithoutRuleProposal: number;

  // Highlights
  topSystemicClusters: TopClusterRow[];
}

/**
 * Compute a self-review snapshot from index rows. Pure function (no
 * filesystem access by default). Pass `ruleProposalIndex` to control
 * the rule-coverage computation in tests.
 */
export function generateSelfReview(
  lessons: IndexedLesson[],
  opts: SelfReviewOptions = {}
): SelfReviewSnapshot {
  const nowMs = opts.nowMs ?? Date.now();
  const windowDays = opts.windowDays ?? DEFAULT_WINDOW_DAYS;
  const topN = opts.topClustersToHighlight ?? DEFAULT_TOP_CLUSTERS;
  const windowStartMs = nowMs - windowDays * 24 * 60 * 60 * 1000;

  // Bucket counts
  let feedbackCount = 0;
  let proposalCount = 0;
  for (const l of lessons) {
    if (l.kind === 'feedback') feedbackCount++;
    else if (l.kind === 'proposal') proposalCount++;
  }

  const clusters = clusterProposals(lessons, {
    ...(opts.systemicThreshold !== undefined
      ? { systemicThreshold: opts.systemicThreshold }
      : {})
  });

  const ruleIdx =
    opts.ruleProposalIndex ?? buildDefaultRuleProposalIndex(opts.memoryDir);

  // Volume within window + classification breakdown
  const breakdownTotal = new Map<string, number>();
  const breakdownWindow = new Map<string, number>();
  let proposalsWithinWindow = 0;
  for (const c of clusters) {
    const totalForCls = (breakdownTotal.get(c.classification) ?? 0) + c.occurrenceCount;
    breakdownTotal.set(c.classification, totalForCls);
    let inWindow = 0;
    for (const m of c.members) {
      if (m.timestampMs >= windowStartMs) inWindow++;
    }
    if (inWindow > 0) {
      breakdownWindow.set(
        c.classification,
        (breakdownWindow.get(c.classification) ?? 0) + inWindow
      );
      proposalsWithinWindow += inWindow;
    }
  }

  const classificationBreakdown: ClassificationBreakdownRow[] = [];
  for (const cls of breakdownTotal.keys()) {
    classificationBreakdown.push({
      classification: cls,
      totalCount: breakdownTotal.get(cls) ?? 0,
      withinWindowCount: breakdownWindow.get(cls) ?? 0
    });
  }
  classificationBreakdown.sort((a, b) => {
    if (a.withinWindowCount !== b.withinWindowCount) {
      return b.withinWindowCount - a.withinWindowCount;
    }
    if (a.totalCount !== b.totalCount) return b.totalCount - a.totalCount;
    return a.classification.localeCompare(b.classification);
  });

  // Cluster shape
  const systemic: Cluster[] = clusters.filter((c) => c.systemic);
  const oneOff = clusters.length - systemic.length;
  const burst = clusters.filter((c) => c.burst).length;
  const sustainedSystemic = systemic.filter((c) => !c.burst).length;

  // Steward-rule coverage
  let withRule = 0;
  let withoutRule = 0;
  for (const c of systemic) {
    const key = `${c.classification}::${c.topicSlug}`;
    if (ruleIdx.has(key)) withRule++;
    else withoutRule++;
  }

  const topSystemicClusters: TopClusterRow[] = systemic.slice(0, topN).map((c) => ({
    classification: c.classification,
    topicSlug: c.topicSlug,
    occurrenceCount: c.occurrenceCount,
    firstSeenIso: new Date(c.firstSeenMs).toISOString(),
    lastSeenIso: new Date(c.lastSeenMs).toISOString(),
    burst: c.burst,
    hasStewardRuleProposal: ruleIdx.has(`${c.classification}::${c.topicSlug}`)
  }));

  return {
    generatedAtIso: new Date(nowMs).toISOString(),
    windowDays,
    windowStartIso: new Date(windowStartMs).toISOString(),
    windowEndIso: new Date(nowMs).toISOString(),

    totalLessons: lessons.length,
    feedbackCount,
    proposalCount,
    embeddingModel: opts.meta?.embeddingModel ?? null,
    embeddingDim: opts.meta?.embeddingDim ?? null,
    lastBuildAtIso:
      opts.meta?.lastBuildAtMs !== null && opts.meta?.lastBuildAtMs !== undefined
        ? new Date(opts.meta.lastBuildAtMs).toISOString()
        : null,
    lastBuildScanned: opts.meta?.lastBuildScanned ?? null,

    proposalsWithinWindow,
    classificationBreakdown,

    totalClusters: clusters.length,
    systemicClusterCount: systemic.length,
    oneOffClusterCount: oneOff,
    burstClusterCount: burst,
    sustainedSystemicCount: sustainedSystemic,

    stewardRuleProposalsOnDisk: ruleIdx.size,
    systemicClustersWithRuleProposal: withRule,
    systemicClustersWithoutRuleProposal: withoutRule,

    topSystemicClusters
  };
}

/**
 * Render a self-review snapshot to a deterministic markdown
 * document. Stable across runs given the same input — safe for
 * checked-in or repeatedly-overwritten files.
 */
export function renderSelfReviewMarkdown(s: SelfReviewSnapshot): string {
  const lines: string[] = [];
  lines.push(`# Mentor self-review — ${s.windowDays}d window`);
  lines.push('');
  lines.push(`Generated: \`${s.generatedAtIso}\``);
  lines.push(`Window: \`${s.windowStartIso}\` → \`${s.windowEndIso}\``);
  lines.push('');

  lines.push('## Index health');
  lines.push('');
  lines.push(`- Total lessons indexed: **${s.totalLessons}**`);
  lines.push(`  - Feedback (durable): ${s.feedbackCount}`);
  lines.push(`  - Proposals (raw incidents): ${s.proposalCount}`);
  lines.push(
    `- Embedding model: ${s.embeddingModel ?? '_(unknown — index meta missing)_'}` +
      (s.embeddingDim !== null ? ` (${s.embeddingDim}-dim)` : '')
  );
  lines.push(
    `- Last build: ${s.lastBuildAtIso ?? '_(unknown)_'}${
      s.lastBuildScanned !== null ? ` (scanned ${s.lastBuildScanned})` : ''
    }`
  );
  lines.push('');

  lines.push(`## Incident volume — last ${s.windowDays}d`);
  lines.push('');
  lines.push(`Total proposals emitted in window: **${s.proposalsWithinWindow}**`);
  lines.push('');
  if (s.classificationBreakdown.length === 0) {
    lines.push('_(no proposals indexed yet)_');
  } else {
    lines.push('| Classification | In window | Total |');
    lines.push('|---|---|---|');
    for (const row of s.classificationBreakdown) {
      lines.push(
        `| \`${row.classification}\` | ${row.withinWindowCount} | ${row.totalCount} |`
      );
    }
  }
  lines.push('');

  lines.push('## Cluster shape');
  lines.push('');
  lines.push(`- Total clusters: **${s.totalClusters}**`);
  lines.push(`  - Systemic (≥ threshold): ${s.systemicClusterCount}`);
  lines.push(`  - One-off: ${s.oneOffClusterCount}`);
  lines.push(`  - Burst: ${s.burstClusterCount}`);
  lines.push(`  - Sustained systemic: ${s.sustainedSystemicCount}`);
  lines.push('');

  lines.push('## Steward-rule coverage');
  lines.push('');
  lines.push(
    `- Steward-rule proposals on disk: **${s.stewardRuleProposalsOnDisk}**`
  );
  lines.push(
    `- Systemic clusters WITH a rule proposal: ${s.systemicClustersWithRuleProposal}`
  );
  lines.push(
    `- Systemic clusters WITHOUT a rule proposal: ${s.systemicClustersWithoutRuleProposal}`
  );
  lines.push('');
  if (s.systemicClustersWithoutRuleProposal > 0) {
    lines.push(
      '> **Action**: run `caia-mentor-propose-steward-rule write` to fill the gap, then operator review.'
    );
    lines.push('');
  }

  lines.push(`## Top systemic clusters (max ${s.topSystemicClusters.length})`);
  lines.push('');
  if (s.topSystemicClusters.length === 0) {
    lines.push('_(none yet — corpus has no systemic patterns above threshold)_');
  } else {
    lines.push('| Classification / topic | Occurrences | Last seen | Burst | Rule proposed |');
    lines.push('|---|---|---|---|---|');
    for (const r of s.topSystemicClusters) {
      lines.push(
        `| \`${r.classification}/${r.topicSlug}\` | ${r.occurrenceCount} | ${r.lastSeenIso} | ${r.burst ? 'yes' : 'no'} | ${r.hasStewardRuleProposal ? 'yes' : 'NO'} |`
      );
    }
  }
  lines.push('');

  lines.push('---');
  lines.push('');
  lines.push(
    '*Mentor Phase-4 PR-3 — `caia-mentor-self-review`. Re-run for a refreshed snapshot.*'
  );
  lines.push('');
  return lines.join('\n');
}

/**
 * Default rule-proposal index — scan `<memoryDir>/proposals/` for
 * `steward-rule-<classification>-<topic>.md` files and build a Set
 * keyed `${classification}::${topicSlug}`. Empty Set if memoryDir is
 * undefined or the proposals dir doesn't exist.
 */
function buildDefaultRuleProposalIndex(memoryDir?: string): Set<string> {
  const out = new Set<string>();
  if (memoryDir === undefined || memoryDir === '') return out;
  const proposalsDir = join(pathResolve(memoryDir), 'proposals');
  if (!existsSync(proposalsDir)) return out;
  let entries: string[];
  try {
    entries = readdirSync(proposalsDir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (!name.startsWith('steward-rule-')) continue;
    if (!name.endsWith('.md')) continue;
    // Format: steward-rule-<classification>-<topic>.md
    const stem = name.slice('steward-rule-'.length, -'.md'.length);
    const dashIdx = stem.indexOf('-');
    if (dashIdx <= 0) continue;
    const classification = stem.slice(0, dashIdx);
    const topic = stem.slice(dashIdx + 1);
    out.add(`${classification}::${topic}`);
  }
  return out;
}
