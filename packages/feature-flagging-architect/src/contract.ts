/**
 * `FeatureFlaggingArchitectContract` — the canonical owned-fields
 * declaration for architect #12 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.12 (Feature Flagging Architect owns `featureFlags.*`)
 *   - task brief (flagsSchema, rolloutStrategies, killSwitches,
 *     experimentationLinkage, auditRequirements)
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. All chosen keys live under the `featureFlags.*`
 * namespace and do not collide with any sibling architect's namespace.
 *
 * Naming note: spec §2.12 lists fields like `flagStore`, `evalSurface`,
 * `defaultValue`, `audienceRule`, `killSwitch`, `abVariantBinding`,
 * `rolloutCurve`, `observabilityBinding`. The task brief consolidates
 * these into five higher-level fields:
 *
 *   - `flagsSchema`            ← per-flag name/type/defaults/audience
 *                                (subsumes flagStore, evalSurface,
 *                                 defaultValue, audienceRule)
 *   - `rolloutStrategies`      ← percentage/canary/ring rollout
 *                                (subsumes rolloutCurve)
 *   - `killSwitches`           ← must-be-toggleable-instantly flags
 *                                (subsumes killSwitch)
 *   - `experimentationLinkage` ← which flags feed which A/B tests
 *                                (subsumes abVariantBinding;
 *                                 forward-references A/B Testing Architect)
 *   - `auditRequirements`      ← who can toggle, audit-log per change
 *                                (new — covers observabilityBinding +
 *                                 governance posture)
 *
 * Per the observability-architect precedent (and the standing rule —
 * newer brief wins): the task brief is the binding name set; the spec
 * outline guides the semantic content of each field. The contract id
 * stays `v1` because no live caller is consuming it yet.
 *
 * Existing tooling: the architect's output is OpenFeature-compatible —
 * `flagsSchema` produces shapes that map directly onto the OpenFeature
 * provider interface; `rolloutStrategies` mirrors LaunchDarkly /
 * Statsig conventions for percentage + ring rollouts. The architect
 * does not import any provider SDK; it specifies fields the runtime
 * will wire up.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the fix-hint
 * dictionary lives next to the contract so the system-prompt builder and
 * the future EA Reviewer can surface it without changing kit shape.
 */
export const FEATURE_FLAGGING_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'featureFlags.flagsSchema':
    'For every flag this ticket introduces, declare: { name (kebab-case), type ("boolean"|"string"|"number"|"json"), description (≤200 chars), defaults (per-environment object — at minimum dev/staging/production), audience (targeting rule: tenant-id list, cohort id, percentage, or "everyone") }. Default flag default is "off" (boolean false / null / empty). Flag names are namespaced by the ticket id: <ticket-id>.<flag-slug>. Never invent a flag not implied by the ticket; missing motivation → omit + flag a risk.',
  'featureFlags.rolloutStrategies':
    'For every flag, declare a rollout strategy: { flag (must match a flagsSchema name), kind ("percentage"|"user-id"|"canary"|"ring-deployment"|"all-at-once"), steps (ordered list — e.g. [{stage:"canary", percent:1, gateMetric:"error_rate<0.5%", soakMinutes:30}, ...]), autoPromote (boolean), rollbackTrigger (metric breach that auto-rolls back) }. Defaults: canary 1% → 10% → 50% → 100% with 30-min soak between stages, auto-rollback on 5xx error_rate spike >2x baseline.',
  'featureFlags.killSwitches':
    'For every flag that gates a code path with material blast-radius (auth, payments, data export, AI inference, third-party API spend), mark it as a kill switch. Schema per entry: { flag, blastRadius ("auth"|"payments"|"data-export"|"ai-inference"|"third-party-spend"|"other"), instantToggle (must be true), bypassReviewQuorum (boolean — true iff incident severity warrants), notificationChannels (array of pager/Slack channels). Kill switches must be flippable in <30s without a deploy. Never gate a kill switch behind a multi-step approval flow.',
  'featureFlags.experimentationLinkage':
    'Forward-reference the A/B Testing Architect: for every flag that drives an experiment, declare { flag, abTestId (placeholder if A/B Testing has not run yet), variants (array of {variantKey, flagValue, allocation:0..1}), holdoutPercent (default 5), primaryMetric (must match an Analytics eventTaxonomy entry once Analytics runs), startDate, durationCapDays (default 28) }. If no experiment is planned for this flag, output an empty array entry [] — never omit the key.',
  'featureFlags.auditRequirements':
    'Governance posture for every flag: { flag, toggleRoles (array of role slugs — default ["operator","oncall"]), requiresChangeRecord (boolean — true for kill switches + flags with bypassReviewQuorum=false), auditLogSink ("default-cloudwatch"|"sentry-breadcrumbs"|"custom"), retentionDays (default 365), reviewCadenceDays (default 90 — stale flags get GC pinged). Every toggle event MUST log: actor, flag, oldValue, newValue, timestamp, reason, environment. Reject any audit posture that lets a flag flip without an audit log entry.'
};

/**
 * The owned section specs in stable order.
 */
export const FEATURE_FLAGGING_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'featureFlags.flagsSchema',
    description:
      'Per-flag schema: name (kebab-case, namespaced by ticket id), type (boolean|string|number|json), per-environment defaults (dev/staging/production at minimum), and audience targeting rule (tenant-id list, cohort, percentage, or "everyone"). The single source of truth for which flags exist for this ticket and how they evaluate.',
    required: true
  },
  {
    path: 'featureFlags.rolloutStrategies',
    description:
      'Per-flag rollout strategy: kind (percentage|user-id|canary|ring-deployment|all-at-once), ordered stages with gate metrics + soak windows, auto-promote posture, rollback trigger. Default canary curve 1% → 10% → 50% → 100% with 30-min soaks and auto-rollback on 5xx spike.',
    required: true
  },
  {
    path: 'featureFlags.killSwitches',
    description:
      'Flags marked as kill switches because they gate code paths with material blast-radius (auth, payments, data export, AI inference, third-party spend). Must be flippable in <30s without a deploy. Bypass-review-quorum only on incidents. Always notify pager + Slack channels on toggle.',
    required: true
  },
  {
    path: 'featureFlags.experimentationLinkage',
    description:
      'Forward-reference to the A/B Testing Architect: which flags drive which A/B experiments, with variant→flagValue allocation, holdout percentage, primary metric (Analytics eventTaxonomy reference), and duration cap. Empty array for flags not driving any experiment — never omit the key.',
    required: true
  },
  {
    path: 'featureFlags.auditRequirements',
    description:
      'Governance posture: who can toggle each flag (role allowlist), whether a change-record is required, audit-log sink, retention window, and stale-flag review cadence. Every toggle MUST emit an audit-log entry with actor + old/new value + reason + environment. Reject any posture that allows a flag to flip without audit.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const FEATURE_FLAGGING_OWNED_FIELD_KEYS: readonly string[] =
  FEATURE_FLAGGING_OWNED_SECTIONS.map(s => s.path);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Per spec §2.12 — Feature Flagging runs on tickets that:
 *
 *   1. Are explicitly tagged for flag/rollout/experimental treatment, OR
 *   2. Touch user-facing code (Page/Widget/Story/Form/List) — because
 *      the architect needs Frontend/Backend output to decide what's
 *      flag-worthy, and any such ticket may need a kill switch around a
 *      risky path.
 *
 * Foundation tickets only get flagged when explicitly marked
 * (`deployment`, `experimental`, `flag`, etc.) — pure infra work
 * usually doesn't ship behind flags.
 */
export function featureFlaggingArchitectAppliesPredicate(ticket: Ticket): boolean {
  const tags = ticket.quality_tags ?? [];

  // Explicit opt-in tags always trigger the architect.
  const explicitTags = [
    'flag',
    'feature-flag',
    'experimental',
    'rollout',
    'canary',
    'kill-switch',
    'ab',
    'ab-test',
    'ring-deployment'
  ];
  for (const t of explicitTags) {
    if (tags.includes(t)) return true;
  }

  // User-facing ticket types — Frontend/Backend always produce upstream
  // output here, so we have something to flag.
  if (
    ticket.type === 'Page' ||
    ticket.type === 'Widget' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List'
  ) {
    return true;
  }

  // Foundation only on explicit opt-in (handled above) OR deployment tag.
  if (ticket.type === 'Foundation' && tags.includes('deployment')) {
    return true;
  }

  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * Feature Flagging is a wave-2 architect — depends on Frontend
 * (`componentTree`, `interactionStates`) and Backend (`apiEndpoints`)
 * so it knows what's flag-worthy.
 *
 * Spec §2.12 originally put it in wave 1 (with A/B Testing as the
 * downstream dependent). The task brief flips this: by reading Frontend
 * + Backend output, Feature Flagging makes informed decisions about
 * what to gate and where to place kill switches. The architect still
 * forward-references A/B Testing via `experimentationLinkage`, which
 * A/B Testing in turn consumes — so the precedence ladder is unchanged.
 *
 * Precedence rank 7 per spec §5.2 — rollout safety (between SEO/perf
 * and API Gateway).
 */
export const FEATURE_FLAGGING_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['frontend', 'backend'],
  precedenceLevel: 7,
  fanoutPolicy: 'always',
  appliesPredicate: featureFlaggingArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const FeatureFlaggingArchitectContract: ArchitectSectionContract = {
  contractId: 'feature-flagging-architect.v1',
  architectName: 'featureFlagging',
  version: '0.1.0',
  sections: FEATURE_FLAGGING_OWNED_SECTIONS,
  architectMeta: FEATURE_FLAGGING_ARCHITECT_META
};
