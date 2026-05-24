/**
 * `TimeMachineArchitectContract` — the canonical owned-fields declaration
 * for architect #14 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.14 (Time Machine Architect)
 *   - spec §11 Architect Brief A14
 *   - V2 operator task brief 2026-05-24 (binding name set: versioningStrategy,
 *     snapshotRetention, revertOperation, descriptionGeneration,
 *     dataConsistency, auditTrail)
 *
 * The V2 task brief is the binding name set (per the standing rule — newer
 * brief wins); spec §2.14's outline (snapshotKey, deployDescription,
 * revertCommand, snapshotRetentionDays, revertScope, perSectionRevertCapability,
 * snapshotStorage) guides the semantic content of each field. The V2
 * field set is the OUTER contract — each owned field describes a policy
 * object that internally exposes the spec's lower-level mechanics.
 *
 * Naming note: the architect's `name` is `'time-machine'` (matches the
 * V2 task brief). The canonical precedence ladder lists this architect
 * under the alias `'timeMachine'` (camelCase). The JSONB namespace under
 * `tickets.architecture` is `timeMachine.*` (camelCase) — matching the
 * cross-architect references already present in `@caia/ea-dispatcher`
 * (conflict-rules.ts: `deploy-without-rollback` reads
 * `timeMachine.revertCommand`) and `@caia/ea-reviewer` (invariants.ts:
 * `devops-blue-green-implies-time-machine-revert`). We follow the
 * accessibility-architect precedent — `name = 'accessibility'`, ladder
 * alias `'a11y'`, JSONB namespace `a11y.*`.
 *
 * Wave-2 architect: depends on Backend Architect's endpoint/handler shape
 * (what mutates) AND Database Architect's `dataLifecycle` (how retention
 * + GDPR delete interact with version snapshots). Without these, the
 * Time Machine can't know what to snapshot or whether revert is safe.
 *
 * Forward-creating revert invariant: a revert is itself a new commit
 * appended to the version chain; it never overwrites a prior version.
 * This is the single most important contract guarantee — the golden
 * test pins it.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

export const TIME_MACHINE_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'timeMachine.versioningStrategy':
    'Every commit captured + described. Output {snapshotKeyTemplate, commitGraph, immutability, snapshotStorage}. snapshotKeyTemplate defaults to `<tenant>/<feature>/<commit-sha>`. commitGraph is `linear` for Story tickets and `branching` for Page tickets that allow concurrent edits. immutability is always `append-only` — never overwrite a prior snapshot. snapshotStorage points to R2 path (mirrors @caia/byo-cloud convention).',
  'timeMachine.snapshotRetention':
    "How long versions are kept + archival rules + GDPR interaction. Output {retentionDays, archivalSink, archivalAfterDays, gdprInteraction, tenantOverrideAllowed}. Default retentionDays=90 (overridable per tenant). archivalSink is the cold-storage R2 bucket. gdprInteraction MUST reference Database Architect's `database.dataLifecycle.gdprDeleteStrategy` for the same data — anonymize-in-snapshot vs purge-and-tombstone are the two safe paths.",
  'timeMachine.revertOperation':
    'FORWARD-CREATING revert — never destructive. Output {invocation, scope, idempotencyKey, forwardCreating:true, postCondition}. invocation defaults to `caia time-machine revert --snapshot <key>`. scope is `feature` for Page tickets, `section` for Widget tickets, both allowed for Story tickets that touch multiple sections. forwardCreating MUST be the literal boolean `true` — the contract rejects any value that implies destructive overwrite. postCondition states the user-observable outcome (e.g. "feature returns to behavior captured at snapshot S; a new snapshot S+N is appended documenting the revert").',
  'timeMachine.descriptionGeneration':
    'Auto-generated per-commit human-readable summary. Output {styleGuide, minWords, maxWords, tense, regenerationPolicy}. Default {minWords:5, maxWords:15, tense:"present", styleGuide:"action-first verb phrase"} per spec §2.14. regenerationPolicy is `on-revert-only` by default (do not auto-rewrite existing descriptions when the ticket re-runs).',
  'timeMachine.dataConsistency':
    "Revert respects DB state vs application state. Output {transactionalPosture, dbStateSnapshot, applicationStateSnapshot, cascadeOnRevert, dependsOnDatabaseLifecycle:true}. transactionalPosture is `atomic` when the revert touches a single tenant schema, `eventual` when it cascades across services. dbStateSnapshot references the upstream Database Architect's table set + jsonbShapes. cascadeOnRevert lists which downstream tables' rows are restored / left alone / orphaned and why. dependsOnDatabaseLifecycle MUST be the literal `true` — the architect refuses to ship a Time Machine spec that ignores DB retention rules.",
  'timeMachine.auditTrail':
    "Every revert logged + attributed to operator action. Output {logSink, attributedFields, retentionDays, immutability:\"append-only\", queryability}. attributedFields MUST include who (operator id), when (UTC timestamp), fromSnapshot, toSnapshot, scope, reason (operator-supplied free text). logSink defaults to the orchestrator's structured-log channel + Postgres `audit_revert_events` table. retentionDays defaults to 7 years (regulatory floor); never less than `snapshotRetention.retentionDays`. immutability MUST be `append-only`."
};

export const TIME_MACHINE_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'timeMachine.versioningStrategy',
    description:
      'How the version chain is materialized + addressed: snapshot key shape, commit graph, immutability posture, snapshot storage path. Every commit captured + described.',
    required: true
  },
  {
    path: 'timeMachine.snapshotRetention',
    description:
      "How long versions are kept + archival rules + GDPR delete interaction. Default 90 days; overridable per tenant. Must reference Database Architect's dataLifecycle for the same data.",
    required: true
  },
  {
    path: 'timeMachine.revertOperation',
    description:
      'Forward-creating revert (never destructive): invocation, scope, idempotency key, postcondition. Revert appends a new snapshot at the chain tip; the historical chain stays intact.',
    required: true
  },
  {
    path: 'timeMachine.descriptionGeneration',
    description:
      'Auto-generated per-commit human-readable summary policy: style guide, length budget (5-15 words default), tense, regeneration triggers.',
    required: true
  },
  {
    path: 'timeMachine.dataConsistency',
    description:
      'How revert respects DB state vs application state: transactional posture, snapshot scopes, cascade rules, explicit dependency on Database dataLifecycle.',
    required: true
  },
  {
    path: 'timeMachine.auditTrail',
    description:
      'Append-only revert audit: log sink, attributed fields (who/when/from/to/scope/reason), retention floor (7 years regulatory), queryability surface.',
    required: true
  }
];

export const TIME_MACHINE_OWNED_FIELD_KEYS: readonly string[] =
  TIME_MACHINE_OWNED_SECTIONS.map(s => s.path);

// ─── Apply predicate ────────────────────────────────────────────────────────

export function timeMachineArchitectAppliesPredicate(ticket: Ticket): boolean {
  if (
    ticket.type === 'Page' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List' ||
    ticket.type === 'Foundation'
  ) {
    return true;
  }
  if (ticket.type === 'Widget') {
    const tags = (ticket.quality_tags ?? []) as readonly string[];
    return (
      tags.includes('versioned') ||
      tags.includes('time-machine') ||
      tags.includes('timeMachine')
    );
  }
  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

export const TIME_MACHINE_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['backend', 'database'],
  precedenceLevel: 15,
  fanoutPolicy: 'always',
  appliesPredicate: timeMachineArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const TimeMachineArchitectContract: ArchitectSectionContract = {
  contractId: 'time-machine-architect.v1',
  architectName: 'time-machine',
  version: '0.1.0',
  sections: TIME_MACHINE_OWNED_SECTIONS,
  architectMeta: TIME_MACHINE_ARCHITECT_META
};
