/**
 * Curator Phase-2 — action layer types.
 *
 * Per `agent/memory/curator_agent_directive.md` ## Output modes 5–8:
 *
 *   5. PR proposals          — low-risk mechanical upgrades (dep bumps,
 *                              config tunings backed by metrics, dead-
 *                              code removal). Operator review then
 *                              merge through Evidence Gate.
 *   6. Backlog directives    — substantial changes (new agent, new
 *                              framework, architecture shift). Filed
 *                              as a memory directive the same way the
 *                              Curator directive itself was filed.
 *   7. Alarms                — urgent (CVE, ToS change, runaway spend,
 *                              threshold-crossed hardware capacity).
 *                              Surfaced immediately, NOT batched into
 *                              the daily digest.
 *   8. Industry briefings    — one-pagers for new tech (model release,
 *                              framework drop): what it is, what it'd
 *                              change for us, recommended action.
 *
 * The Action type below is a discriminated union over all four modes.
 * Phase-2 PR-1 ships the union + the classifier (findings → actions)
 * + the alarm emitter (writes files to disk). PR-2 adds the PR-proposal
 * + backlog-directive emitters. PR-3 adds the industry-briefing scanner
 * + a unified `caia-curator act` runner that emits everything at once.
 */

import type { Severity } from '../types.js';

/**
 * Action kinds — one per directive output mode 5..8. Each kind has its
 * own emitter (Phase-2 PR-1: alarm; PR-2: pr-proposal + backlog-
 * directive; PR-3: industry-briefing).
 */
export type ActionKind =
  | 'pr-proposal'
  | 'backlog-directive'
  | 'alarm'
  | 'industry-briefing';

/**
 * Common fields across all action kinds. Each kind extends this with
 * its own discriminator + extra fields.
 */
export interface BaseAction {
  /** Stable slug used as the filename stem (without `.md` extension). */
  slug: string;
  /** Human-readable headline. Becomes the markdown H1. */
  title: string;
  /**
   * Source-finding IDs that motivated this action (deduplicated).
   * Empty for industry-briefings (those originate from the watchlist
   * scanner in PR-3, not from a Finding).
   */
  sourceFindings: string[];
  /** Short paragraph describing the action's intent. */
  summary: string;
  /**
   * Evidence — file paths, command outputs, link URLs, line numbers.
   * Same shape as `Finding.evidence`. Rendered as a bullet list.
   */
  evidence: string[];
  /** Recommended next step. Rendered as a final paragraph. */
  recommendation: string;
  /** When the action was generated. ISO-8601 string. */
  detectedAt: string;
}

/** Output mode 5 — low-risk mechanical PR proposal. */
export interface PrProposalAction extends BaseAction {
  kind: 'pr-proposal';
  /**
   * Suggested branch name (without leading `feat/` / `chore/`). The
   * emitter prefixes `chore/curator-` for mechanical changes by default.
   */
  branchSuffix: string;
  /**
   * Files the PR is expected to touch (relative to repo root). Used in
   * the operator-review checklist of the rendered markdown.
   */
  affectedPaths: string[];
}

/** Output mode 6 — backlog directive for substantial changes. */
export interface BacklogDirectiveAction extends BaseAction {
  kind: 'backlog-directive';
  /**
   * The dimension (from the directive's 80-dimension taxonomy) this
   * directive is most-aligned with. Used in the YAML frontmatter.
   */
  dimension: string;
  /**
   * Effort estimate, mirrored from the source finding(s). Surfaces in
   * the directive frontmatter so master-sequencing can prioritise.
   */
  effortEstimate: 'small' | 'medium' | 'large' | 'xlarge';
}

/** Output mode 7 — urgent alarm. */
export interface AlarmAction extends BaseAction {
  kind: 'alarm';
  /**
   * Severity copied from the source finding (always `critical` or
   * `high` — anything lower goes through the digest, not the alarm
   * channel).
   */
  severity: Extract<Severity, 'critical' | 'high'>;
  /** The dimension touched (free-form, mirrored from the finding). */
  dimension: string;
}

/** Output mode 8 — industry briefing one-pager. */
export interface IndustryBriefingAction extends BaseAction {
  kind: 'industry-briefing';
  /**
   * The watchlist topic that triggered the briefing (e.g.
   * `anthropic-claude-release`, `mcp-spec-update`). Used as part of
   * the slug + as the frontmatter `topic` value.
   */
  topic: string;
  /**
   * Source URL the briefing references. Optional — operator-supplied
   * watchlist entries usually carry one; manually-filed briefings may
   * not.
   */
  sourceUrl?: string;
}

/** Discriminated union over all action kinds. */
export type Action =
  | PrProposalAction
  | BacklogDirectiveAction
  | AlarmAction
  | IndustryBriefingAction;

/**
 * Where an emitter wrote (or would have written) an action file. Used
 * by CLI summaries.
 */
export interface EmittedActionRef {
  /** Absolute path to the written file. */
  path: string;
  /** The slug. */
  slug: string;
  /** The action kind. */
  kind: ActionKind;
}

/** Result returned by every emitter (alarm, pr-proposal, etc.). */
export interface EmitResult {
  /** Output directory the emitter wrote to. */
  outputDir: string;
  /** How many files were freshly written. */
  writtenCount: number;
  /** How many files already existed and were skipped (idempotency). */
  skippedCount: number;
  /** Per-action references for what was written. */
  written: EmittedActionRef[];
  /** Per-action references for what was skipped. */
  skipped: EmittedActionRef[];
}
