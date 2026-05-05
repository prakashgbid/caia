/**
 * Mentor Phase-4 PR-2 — Steward rule proposal generator.
 *
 * Given a systemic cluster (from `cluster.ts`), emit a markdown
 * proposal that Mentor hands to operator review and, on approval,
 * Steward picks up as a permanent gatekeeper rule.
 *
 * The directive (`mentor_agent_directive.md` ## Phase 4) is explicit:
 *
 *   "When systemic, propose a Steward rule (PR to Steward checks).
 *    Quarterly self-review."
 *
 * and (## Distinct from Steward and Curator):
 *
 *   "A new failure mode is detected by Mentor (incident), proposed as
 *    a permanent rule by Mentor, then enforced by Steward."
 *
 * So this layer does NOT modify Steward code. It produces a
 * markdown proposal that:
 *
 *   1. Lands under `<memoryDir>/proposals/steward-rule-<slug>.md` so
 *      it joins the existing review queue.
 *   2. Carries enough metadata for an operator to one-shot decide
 *      "yes, promote to a Steward rule" or "no, this is a one-off".
 *   3. Is stable across runs — the same cluster produces the same
 *      proposal text, so re-running the proposer is idempotent and
 *      safe in cron.
 *
 * This file deliberately does NOT touch Steward's analyzer code or
 * open a code PR. That step (the actual rule wiring under
 * `packages/steward-analyzers/`) is operator-driven; Mentor stops at
 * the proposal boundary.
 *
 * The proposed check shape is a recommendation only — Steward's
 * existing analyzer family (gitflow-conformance, gitleaks, semgrep,
 * the steward-gatekeeper-* trio) decides which one of them is the
 * right home for the new rule once it's approved.
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve as pathResolve } from 'node:path';

import type { Cluster, ProposalMetadata } from './cluster.js';

/**
 * One Steward-rule proposal — the structured shape emitted from a
 * cluster. The CLI renders this to markdown (and optionally JSON)
 * before writing.
 */
export interface StewardRuleProposal {
  /** Stable identifier — used as filename slug. */
  proposalSlug: string;
  /** Classification token from the cluster (e.g. 'prematurecompletion'). */
  classification: string;
  /** Topic slug from the cluster (collision-suffix already stripped). */
  topicSlug: string;
  /** Total members in the cluster at proposal time. */
  occurrenceCount: number;
  /** Cluster span in ms. */
  spanMs: number;
  /** First / last ISO timestamps of cluster members. */
  firstSeenIso: string;
  lastSeenIso: string;
  /** Was the cluster a burst (per Cluster.burst)? */
  burst: boolean;
  /** Human-readable proposed check title. */
  proposedCheckTitle: string;
  /** Categorical check phase. */
  proposedCheckType: 'pre-merge' | 'post-merge' | 'cron' | 'unclassified';
  /** Free-form markdown body — trigger heuristic. */
  triggerHeuristic: string;
  /** Free-form markdown body — remediation guidance. */
  remediationGuidance: string;
  /** Slimmed cluster members for the evidence section. */
  evidence: {
    sourcePath: string;
    rawSlug: string;
    timestampIso: string;
  }[];
}

/**
 * Build a proposal from a single cluster. Pure function.
 *
 * The `classification` token routes to a default check phase + a
 * default trigger heuristic. Routing is conservative — when we don't
 * have a recipe, we fall back to `unclassified` and ask the operator
 * to fill in the check shape.
 */
export function proposeStewardRule(cluster: Cluster): StewardRuleProposal {
  const recipe = checkRecipeFor(cluster.classification);

  return {
    proposalSlug: `steward-rule-${cluster.classification}-${cluster.topicSlug}`,
    classification: cluster.classification,
    topicSlug: cluster.topicSlug,
    occurrenceCount: cluster.occurrenceCount,
    spanMs: cluster.lastSeenMs - cluster.firstSeenMs,
    firstSeenIso: new Date(cluster.firstSeenMs).toISOString(),
    lastSeenIso: new Date(cluster.lastSeenMs).toISOString(),
    burst: cluster.burst,
    proposedCheckTitle: recipe.title(cluster),
    proposedCheckType: recipe.checkType,
    triggerHeuristic: recipe.triggerHeuristic(cluster),
    remediationGuidance: recipe.remediationGuidance(cluster),
    evidence: cluster.members.map((m) => slimEvidence(m))
  };
}

/**
 * Render a proposal as markdown, ready to write under
 * `<memoryDir>/proposals/`. Output is deterministic — no timestamps,
 * no random IDs, so re-running with the same input produces the same
 * file (idempotent for the writer below).
 */
export function renderStewardRuleProposalMarkdown(p: StewardRuleProposal): string {
  const evidenceLines = p.evidence
    .map((e) => `- \`${e.rawSlug}\` (\`${e.timestampIso}\`) — \`${e.sourcePath}\``)
    .join('\n');

  return `---
name: Steward rule proposal — ${p.proposedCheckTitle}
description: "Mentor Phase-4 systemic-pattern Steward rule proposal — ${p.classification} / ${p.topicSlug} (${p.occurrenceCount} occurrences)"
type: steward-rule-proposal
classifiedAs: ${p.classification}
topicSlug: ${p.topicSlug}
occurrenceCount: ${p.occurrenceCount}
firstSeen: ${p.firstSeenIso}
lastSeen: ${p.lastSeenIso}
burst: ${String(p.burst)}
proposedCheckType: ${p.proposedCheckType}
---

# Steward rule proposal — ${p.proposedCheckTitle}

## Why

Mentor's clustering layer (Phase-4 PR-1) detected a **systemic** pattern
of ${p.occurrenceCount} occurrences of \`${p.classification}/${p.topicSlug}\`
spanning \`${p.firstSeenIso}\` → \`${p.lastSeenIso}\`. ${p.burst ? '**Burst** signal — the entire cluster fired inside a tight window, suggesting a single root-cause loop rather than recurrent independent failures. Verify the underlying source has been addressed before approving this rule.' : 'Sustained signal — occurrences spread across a meaningful time span, which is the directive\'s threshold for promoting a class of failure to a permanent gatekeeper.'}

This proposal exists because the directive
(\`agent/memory/mentor_agent_directive.md\` ## Phase 4) mandates: when
N≥3 incidents share a classification + topic, propose a Steward rule
that mechanically catches the next instance before it merges or after
it lands.

## Proposed check

**Type**: \`${p.proposedCheckType}\`

**Trigger heuristic** (when Steward should fire):

${p.triggerHeuristic}

## Remediation guidance

${p.remediationGuidance}

## Evidence

${evidenceLines}

## How to apply

1. Operator review: skim 2-3 evidence entries. Confirm the cluster is genuinely systemic and not a single watcher-loop bug emitting duplicate proposals.
2. If approved, route to \`packages/steward-analyzers/\`. Existing analyzer families (gitflow-conformance, gitleaks, semgrep, steward-gatekeeper-{branch,signing,artifacts}) are the most likely homes; pick the one whose data shape matches the trigger heuristic.
3. Wire the rule, write the test, ship via the Steward-analyzers PR pipeline. Mentor's job ends here.
4. Once Steward enforces this rule, the corresponding cluster should stop growing — that's the success metric Phase-4 PR-3 (quarterly self-review) tracks.

---

*This is a Mentor Phase-4 auto-generated systemic-pattern Steward rule proposal. Operator review required before promoting to a Steward analyzer.*
`;
}

/** Result of a write run — what got written, what was skipped. */
export interface WriteStewardRuleProposalsResult {
  written: { path: string; proposalSlug: string }[];
  skipped: { path: string; proposalSlug: string; reason: 'already-exists' }[];
  proposalsDir: string;
}

export interface WriteStewardRuleProposalsOptions {
  memoryDir: string;
  /** If true, overwrite existing proposal files. Default: false. */
  force?: boolean;
  /**
   * If true, only emit per-cluster proposals; the writer is purely
   * idempotent. Default: false (writer creates the proposals dir if
   * missing).
   */
  dryRun?: boolean;
}

/**
 * Write one rule proposal per cluster under
 * `<memoryDir>/proposals/<proposalSlug>.md`.
 *
 * When `force === false` (default), an existing proposal file is
 * preserved (operator may have already started reviewing it).
 *
 * When `dryRun === true`, no files are written — useful for the
 * `caia-mentor-propose-steward-rule list` subcommand.
 */
export function writeStewardRuleProposals(
  clusters: Cluster[],
  opts: WriteStewardRuleProposalsOptions
): WriteStewardRuleProposalsResult {
  const proposalsDir = join(pathResolve(opts.memoryDir), 'proposals');
  const force = opts.force ?? false;
  const dryRun = opts.dryRun ?? false;

  if (!dryRun && !existsSync(proposalsDir)) {
    mkdirSync(proposalsDir, { recursive: true });
  }

  const written: { path: string; proposalSlug: string }[] = [];
  const skipped: {
    path: string;
    proposalSlug: string;
    reason: 'already-exists';
  }[] = [];

  for (const cluster of clusters) {
    const proposal = proposeStewardRule(cluster);
    const filePath = join(proposalsDir, `${proposal.proposalSlug}.md`);

    if (!force && existsSync(filePath)) {
      skipped.push({
        path: filePath,
        proposalSlug: proposal.proposalSlug,
        reason: 'already-exists'
      });
      continue;
    }

    if (!dryRun) {
      writeFileSync(filePath, renderStewardRuleProposalMarkdown(proposal), 'utf-8');
    }
    written.push({ path: filePath, proposalSlug: proposal.proposalSlug });
  }

  return { written, skipped, proposalsDir };
}

interface CheckRecipe {
  title: (c: Cluster) => string;
  checkType: StewardRuleProposal['proposedCheckType'];
  triggerHeuristic: (c: Cluster) => string;
  remediationGuidance: (c: Cluster) => string;
}

/**
 * Routing table from classification token to a default check recipe.
 *
 * The recipes are intentionally conservative — they describe what
 * Steward could detect mechanically (e.g. CI status post-merge), not
 * the deeper semantic interpretation. Operator picks up the semantic
 * step when promoting the proposal.
 */
function checkRecipeFor(classification: string): CheckRecipe {
  switch (classification) {
    case 'prematurecompletion':
      return {
        title: (c) => `block premature-completion for ${c.topicSlug}`,
        checkType: 'post-merge',
        triggerHeuristic: () =>
          [
            '- After a PR merges, watch the canonical CI run on the merge commit.',
            '- If the same job class fails on the merge commit, classify as PrematureCompletion and surface as a high-priority Steward alert.',
            '- Bonus: refuse to mark the next PR\'s Stage-6 (Test+integrate) green until the failing job class has been fixed locally.'
          ].join('\n'),
        remediationGuidance: () =>
          [
            'Run the failing job class locally before declaring a PR ready. If it\'s an integration / e2e job that\'s expensive locally, at least run the unit test that exercises the same code path. PR-claimed-done while CI is red on the merge commit is a Stage-6 failure of the 6-stage DoD — re-do Stage 6 (test+integrate) before merging anything that touches the same code path.'
          ].join('\n')
      };
    case 'relitigation':
      return {
        title: (c) => `block re-litigation of ${c.topicSlug}`,
        checkType: 'pre-merge',
        triggerHeuristic: () =>
          [
            '- Pre-send / pre-merge: scan PR descriptions, commit messages, and Mentor-emitted proposals for "security finding", "should be rotated", "credential leak", or related re-litigation phrasing on topics already settled in `feedback_pat_topic.md` (or whatever feedback file is the canonical authority).',
            '- If the topic has a settled feedback entry within memoryDir, surface that entry as a hard block on the agent\'s output until acknowledged.'
          ].join('\n'),
        remediationGuidance: () =>
          [
            'Consult the relevant `feedback_*.md` BEFORE proposing a security finding or topic re-evaluation. Re-litigation is the explicit failure mode the Mentor pre-spawn injection (Phase 3) was built to prevent — if a re-litigation incident still leaks through, treat it as a defect in the prepend hook coverage, not a fresh classification problem.'
          ].join('\n')
      };
    case 'decisionclassifierviolation':
      return {
        title: (c) => `block decision-classifier violations for ${c.topicSlug}`,
        checkType: 'pre-merge',
        triggerHeuristic: () =>
          [
            '- Pre-send mechanical scan of agent output for "want me to / should I / your call" phrasing on technical matters.',
            '- Refuse the message; require the agent to decide → execute → inform per `feedback_decision_classifier.md`.'
          ].join('\n'),
        remediationGuidance: () =>
          [
            'On technical matters Mentor + every agent must decide and act, not present options. Operator-decision boundaries (architecture / product pivots) are the only exception, and those are explicitly enumerated in `feedback_autonomous_operation.md`.'
          ].join('\n')
      };
    case 'coordinationfailure':
    case 'gitbranchhygienefailure':
      return {
        title: (c) => `block ${classification} for ${c.topicSlug}`,
        checkType: 'cron',
        triggerHeuristic: () =>
          [
            '- Daily cron sweep: detect orphan branches, never-merged stashes, worktree-count-over-cap, force-push activity outside expected branches.',
            '- If any condition trips, file a daily Steward alert until cleared.'
          ].join('\n'),
        remediationGuidance: () =>
          [
            'Cap concurrent worktrees ≤ 8; cap concurrent substantial Mac-targeted tasks ≤ 2 unless the operator explicitly authorises more. Memory: leg-3 chaos audit (51 tasks, 1,477 mac_mcp timeouts/hour, 41 worktrees at peak) is the canonical cautionary tale.'
          ].join('\n')
      };
    case 'unclassified':
      return {
        title: (c) => `manual review needed for ${c.topicSlug} cluster`,
        checkType: 'unclassified',
        triggerHeuristic: () =>
          [
            '- Unclassified cluster — Mentor\'s automatic taxonomy did not assign a primary failure mode.',
            '- Operator must skim 2-3 evidence entries and decide:',
            '  1. Add a new classification to the taxonomy (`mentor_agent_directive.md` ## Failure-mode taxonomy) and re-run the proposer, OR',
            '  2. Mark the cluster as noise and let it age out, OR',
            '  3. Hand-write the trigger heuristic + check type in this proposal.'
          ].join('\n'),
        remediationGuidance: () =>
          [
            'Unclassified clusters are usually a sign that the failure-mode taxonomy is missing a category. Adding a category is preferable to letting clusters fester at "unclassified", because the next pre-spawn injection won\'t surface useful warnings without a category routing.'
          ].join('\n')
      };
    default:
      return {
        title: (c) => `${classification} cluster — ${c.topicSlug}`,
        checkType: 'unclassified',
        triggerHeuristic: () =>
          [
            `- Mentor's classification recipe table does not yet have an entry for \`${classification}\`.`,
            '- Operator should pick up the semantic interpretation manually and add a recipe in a follow-up PR.'
          ].join('\n'),
        remediationGuidance: () =>
          [
            `Add a \`case '${classification}':\` entry under \`checkRecipeFor()\` in \`packages/mentor-retrieval/src/steward-rule-proposer.ts\` so future runs of this proposer have a meaningful default to suggest.`
          ].join('\n')
      };
  }
}

function slimEvidence(m: ProposalMetadata): {
  sourcePath: string;
  rawSlug: string;
  timestampIso: string;
} {
  return {
    sourcePath: m.sourcePath,
    rawSlug: m.rawSlug,
    timestampIso: new Date(m.timestampMs).toISOString()
  };
}
