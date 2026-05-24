/**
 * `UxVersionControlArchitectContract` — the canonical owned-fields
 * declaration for architect #15 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.15 (UX Version Control Architect)
 *   - spec §11 Architect Brief A15
 *   - V2 operator task brief 2026-05-24 (binding name set:
 *     designVersionRetention, revertOperation, diffVisualizationSpec,
 *     branchingStrategy, auditTrail)
 *
 * The V2 task brief is the binding name set (per the standing rule — newer
 * brief wins, mirrored from how `@caia/time-machine-architect` followed
 * its V2 brief over spec §2.14). Spec §2.15's outline (uploadVersionId,
 * parentVersionId, diffSummary, revertToVersionId, replayMode,
 * selectiveRevertScope, preservationGuarantee, atlasAnchorRefs) is folded
 * into the semantic content of each V2 field — the V2 field set is the
 * OUTER contract, each owned field describes a policy object that
 * internally surfaces the spec's lower-level mechanics.
 *
 * Naming note: the architect's `name` is `'ux-version-control'` (matches
 * the V2 task brief). The canonical precedence ladder lists this
 * architect under the alias `'uxVersionControl'` (camelCase). The JSONB
 * namespace under `tickets.architecture` is `uxVersionControl.*`
 * (camelCase) — matching the precedence-ladder convention already
 * established for `'timeMachine'` (Time Machine Architect uses
 * `name='time-machine'`, namespace `timeMachine.*`).
 *
 * Wave-1 architect (`dependsOn: []`). Reads `designVersion` directly
 * from input; no upstream architect outputs required. Precedence rank
 * 16 per spec §5.2 (operator-facing; not safety-critical — sits just
 * below Time Machine, just above Testing).
 *
 * Disjoint by construction with `timeMachine.*` (CODE-level versioning):
 * - Time Machine owns CODE-level commits, deploys, rollbacks.
 * - UX Version Control owns DESIGN-level uploads, design diffs, design
 *   reverts. The two contracts never collide because their JSONB
 *   namespaces are disjoint.
 *
 * Forward-creating revert invariant: a design revert is itself a new
 * version appended to the design-version chain; it never overwrites a
 * prior version. This is the single most important contract guarantee
 * — the golden test pins it. Mirrors the immutability guarantee proven
 * in `@caia/atlas-design-snapshotter` (PR #538: `captureSnapshot()` and
 * `revertToVersion()` are append-only by construction).
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

export const UX_VERSION_CONTROL_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'uxVersionControl.designVersionRetention':
    'How many design uploads kept + archival rules + GDPR interaction. Output {maxVersionsKept, retentionDays, archivalSink, archivalAfterDays, gdprInteraction, tenantOverrideAllowed, preservationGuarantee}. Default {maxVersionsKept:"unlimited", retentionDays:"forever", archivalAfterDays:90, gdprInteraction:"anonymize-in-version", preservationGuarantee:"immutable-r2-storage"}. The spec posture (every uploaded UX preserved forever — no deletes) is the floor; `gdprInteraction` MUST be anonymize-in-version or purge-and-tombstone — never hard-delete. `preservationGuarantee` MUST be the literal `"immutable-r2-storage"`.',
  'uxVersionControl.revertOperation':
    'FORWARD-CREATING revert — never destructive. Output {invocation, scope, idempotencyKey, forwardCreating:true, replayMode, selectiveRevertScope, postCondition}. invocation defaults to `caia ux-version-control revert --version <versionId>`. scope is `design` for Page tickets, `section` for Widget tickets, both allowed for Site-level tickets that touch multiple Atlas anchors. forwardCreating MUST be the literal boolean `true` — the contract rejects any value that implies destructive overwrite. replayMode is `full` (re-architect every dependent ticket from the reverted IR) or `selective` (re-architect only tickets that touch the selectiveRevertScope anchors). postCondition states the user-observable outcome (e.g. "design returns to upload captured at version V; a new version V+N is appended documenting the revert").',
  'uxVersionControl.diffVisualizationSpec':
    'What the diff between v1 and v2 of a UX upload looks like. Output {renderSurface, diffLayers, narrationStyle, anchorRefs}. renderSurface defaults to `atlas-design-snapshotter`. diffLayers MUST be a non-empty array listing the diff dimensions (tree, token, copy, asset, interactivity) — these mirror @caia/atlas-design-snapshotter\'s diff layers (PR #538). narrationStyle is `semantic` (e.g. "added 2 sections, modified 1 widget, removed 0 anchors") per spec §2.15. anchorRefs lifts the design anchor IDs the diff applies to from `designVersion.anchors`.',
  'uxVersionControl.branchingStrategy':
    'Can a customer fork a design version? Output {forkAllowed, mergeStrategy, abandonmentPolicy, namingTemplate, maxConcurrentBranches}. forkAllowed defaults to `false` (V1 posture: linear chain only; branching is a V2 follow-on). When forkAllowed=true, mergeStrategy is one of `manual-merge|fast-forward|theirs|ours` and abandonmentPolicy specifies what happens to forks that go untouched (`auto-archive-after-30-days` is the default). namingTemplate defaults to `<parent-versionId>-fork-<ulid>`. maxConcurrentBranches defaults to 5 — beyond which uploads must reuse an existing branch.',
  'uxVersionControl.auditTrail':
    'Every UX upload + revert logged + attributed to operator action. Output {logSink, attributedFields, retentionDays, immutability:"append-only", queryability}. attributedFields MUST include who (operator id), when (UTC timestamp), versionId, parentVersionId, eventKind (`upload`|`revert`|`fork`|`merge`), reason (operator-supplied free text). logSink defaults to the orchestrator\'s structured-log channel + Postgres `audit_ux_version_events` table. retentionDays defaults to 7 years (regulatory floor); never less than `designVersionRetention.retentionDays` (which is "forever" by default, encoded as 365_25 * 100 = 36_525 days). immutability MUST be `append-only`.'
};

export const UX_VERSION_CONTROL_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'uxVersionControl.designVersionRetention',
    description:
      'How many design uploads are kept + archival rules + GDPR delete interaction. Default posture: every uploaded UX preserved forever in immutable R2 storage (per spec §2.15). Tenant override allowed for retention floor but never for the preservation guarantee.',
    required: true
  },
  {
    path: 'uxVersionControl.revertOperation',
    description:
      'Forward-creating revert (never destructive): invocation, scope, idempotency key, replay mode, selective revert scope, post-condition. Revert appends a new design version at the chain tip; the historical chain stays intact.',
    required: true
  },
  {
    path: 'uxVersionControl.diffVisualizationSpec',
    description:
      'What the diff between v1 and v2 of a UX upload looks like: render surface (atlas-design-snapshotter), diff layers (tree/token/copy/asset/interactivity), narration style (semantic — "added X sections, modified Y widgets"), anchor refs.',
    required: true
  },
  {
    path: 'uxVersionControl.branchingStrategy',
    description:
      'Can a customer fork a design version? Fork-allowed flag, merge strategy, abandonment policy, naming template, concurrent-branch ceiling. Default V1 posture: linear chain only; branching is a V2 follow-on.',
    required: true
  },
  {
    path: 'uxVersionControl.auditTrail',
    description:
      'Append-only UX upload + revert audit: log sink, attributed fields (who/when/versionId/parentVersionId/eventKind/reason), retention floor (7 years regulatory), queryability surface.',
    required: true
  }
];

export const UX_VERSION_CONTROL_OWNED_FIELD_KEYS: readonly string[] =
  UX_VERSION_CONTROL_OWNED_SECTIONS.map(s => s.path);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.15 — UX Version Control runs whenever a UX asset is in play.
 * The architect brief A15 lists scope=site, but per-ticket UX uploads
 * also flow through Page / Story / Widget / Form / List tickets that
 * carry a `designVersion`. We default to running on all ticket types
 * that carry UX (everything except pure Foundation/Infra) so the audit
 * trail + retention spec is computed eagerly.
 */
export function uxVersionControlArchitectAppliesPredicate(ticket: Ticket): boolean {
  return (
    ticket.type === 'Page' ||
    ticket.type === 'Widget' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List' ||
    ticket.type === 'Site'
  );
}

// ─── Architect meta ─────────────────────────────────────────────────────────

export const UX_VERSION_CONTROL_ARCHITECT_META: ArchitectMeta = {
  dependsOn: [],
  precedenceLevel: 16,
  fanoutPolicy: 'always',
  appliesPredicate: uxVersionControlArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const UxVersionControlArchitectContract: ArchitectSectionContract = {
  contractId: 'ux-version-control-architect.v1',
  architectName: 'ux-version-control',
  version: '0.1.0',
  sections: UX_VERSION_CONTROL_OWNED_SECTIONS,
  architectMeta: UX_VERSION_CONTROL_ARCHITECT_META
};
