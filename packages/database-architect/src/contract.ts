/**
 * `DatabaseArchitectContract` — the canonical owned-fields declaration for
 * architect #3 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.3 (Database Architect owns `database.*`)
 *   - task brief (tables, columns, indexes, migrations, relationships,
 *     rlsPolicies, tenantIsolationStrategy, dataLifecycle)
 *
 * The reconciled superset below includes both the spec §2.3 stack-lock /
 * structural fields (engine, jsonbShapes, queryHints) and the task brief's
 * tenant-isolation + lifecycle fields. Every field is marked
 * `required: true` because downstream architects (Security, DevOps,
 * Observability) read these — missing fields cascade.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. The chosen keys all live under the `database.*`
 * namespace and do not collide with any sibling architect's namespace.
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
export const DATABASE_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'database.engine':
    'Default to {"name":"postgres","version":"16.x","orm":"drizzle"}. Reject any decision that picks MySQL, SQLite, or a non-relational store.',
  'database.tables':
    'Project each persistence touchpoint in Backend\'s `endpointEnumeration` into one table. Plural snake_case names. Every table must declare a UUID primary key unless the ticket explicitly requires otherwise.',
  'database.columns':
    'Per-table column specs: {name, type, nullable, default, check, comment}. Use Postgres types verbatim (text, uuid, timestamptz, jsonb, numeric, …). `created_at` + `updated_at` timestamptz are mandatory on every table.',
  'database.indexes':
    'GIN indexes on every JSONB column queried by a Backend endpoint. B-tree on every FK column. Unique indexes on natural keys (email, slug). Compound indexes only where Backend\'s `queryHints` justify them.',
  'database.migrations':
    'Drizzle/Prisma migration plan. Additive-only by default (no DROP COLUMN, no NOT NULL adds without a backfill step). Each entry: {id, description, up, down, ordering, requiresOperatorReview}.',
  'database.relationships':
    'FK constraints + cascade rules. Edges: {from: "<table>.<column>", to: "<table>.<column>", onDelete, onUpdate, deferrable?}. Reject any orphan-allowed FK on a tenant-scoped table.',
  'database.rlsPolicies':
    'ALTER TABLE ... ENABLE ROW LEVEL SECURITY on every tenant-scoped table. Default policies: tenant_isolation (USING current_setting(\'app.tenant_id\') = tenant_id), service_role_bypass for the orchestrator role.',
  'database.tenantIsolationStrategy':
    'Default schema-per-tenant matching CAIA\'s meta cluster. Output {model:"schema-per-tenant"|"row-level"|"hybrid", justification, schemaNameTemplate?, sharedTables?}. Reject row-level only without explicit operator override.',
  'database.dataLifecycle':
    'Per-table retention + archival + GDPR delete rules: {table, retentionDays, archivalSink, gdprDeleteStrategy:"hard"|"soft"|"anonymize", cascadeOnUserDelete}.',
  'database.jsonbShapes':
    'For every JSONB column declared in `columns`, output a Zod-style descriptor of the expected shape. Schema-less JSONB is a code smell — list under `risks` if unavoidable.',
  'database.queryHints':
    'Read/write access patterns derived from Backend\'s endpoints: {endpoint, table, op:"read"|"write"|"upsert", indexCandidate?, expectedQps?, p95LatencyTargetMs?}.'
};

/**
 * The owned section specs in stable order.
 */
export const DATABASE_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'database.engine',
    description:
      'Locked: Postgres 16. Output the engine + version + ORM choice so downstream architects (DevOps, Security) can validate compatibility.',
    required: true
  },
  {
    path: 'database.tables',
    description:
      'Canonical table definitions: name, primary key, comment, scope (tenant-scoped|shared|metacluster). Project every Backend persistence touchpoint into a table.',
    required: true
  },
  {
    path: 'database.columns',
    description:
      'Per-table column specs (type, nullability, default, check constraint, comment). Mandatory `id uuid pk`, `created_at timestamptz`, `updated_at timestamptz` on every table.',
    required: true
  },
  {
    path: 'database.indexes',
    description:
      'Index specs: B-tree on FKs, GIN on JSONB query paths, unique on natural keys, compound indexes justified by Backend `queryHints`.',
    required: true
  },
  {
    path: 'database.migrations',
    description:
      'Additive-only migration plan with explicit up/down DDL per migration. Destructive migrations require operator review and a backfill step.',
    required: true
  },
  {
    path: 'database.relationships',
    description:
      'FK constraints + cascade rules. The relationship graph used by Backend\'s ORM bindings and by Observability\'s trace context propagation.',
    required: true
  },
  {
    path: 'database.rlsPolicies',
    description:
      'Row-Level Security policies per tenant-scoped table. Default policies (tenant_isolation, service_role_bypass) + per-table additions.',
    required: true
  },
  {
    path: 'database.tenantIsolationStrategy',
    description:
      'Per-tenant isolation model — default schema-per-tenant matching CAIA\'s meta cluster. The DevOps Architect reads this to wire migration runners per tenant schema.',
    required: true
  },
  {
    path: 'database.dataLifecycle',
    description:
      'Per-table retention, archival, GDPR delete strategy (hard|soft|anonymize), and cascade rules on user-account deletion. Drives the data-deletion runbook.',
    required: true
  },
  {
    path: 'database.jsonbShapes',
    description:
      'Zod-style descriptors for every JSONB column. Schema-less JSONB is a code smell — flagged in `risks` when unavoidable.',
    required: true
  },
  {
    path: 'database.queryHints',
    description:
      'Per-endpoint access patterns derived from Backend\'s endpoint enumeration. Feeds index selection + Observability\'s P95 latency SLOs.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const DATABASE_OWNED_FIELD_KEYS: readonly string[] = DATABASE_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.3 — Database runs on Page, Story, Form, List, and Foundation tickets
 * (anything that touches persistence). Widget tickets typically do NOT
 * persist their own data (they re-use parent-Page schema), so they're excluded
 * unless flagged with the `persists` quality tag.
 */
export function databaseArchitectAppliesPredicate(ticket: Ticket): boolean {
  if (
    ticket.type === 'Page' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List' ||
    ticket.type === 'Foundation'
  ) {
    return true;
  }
  // Widget tickets persist only when explicitly tagged.
  if (ticket.type === 'Widget') {
    const tags = ticket.quality_tags ?? [];
    return tags.includes('persists') || tags.includes('database');
  }
  return false;
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * Database is a wave-2 architect (`dependsOn: ['backend']`). Precedence rank
 * 11 per spec §5.2 — above Backend (12) because schema correctness trumps
 * functional correctness in conflict resolution, and below Analytics (10)
 * which has compliance-sensitive consent-gating concerns.
 */
export const DATABASE_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['backend'],
  precedenceLevel: 11,
  fanoutPolicy: 'always',
  appliesPredicate: databaseArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const DatabaseArchitectContract: ArchitectSectionContract = {
  contractId: 'database-architect.v1',
  architectName: 'database',
  version: '0.1.0',
  sections: DATABASE_OWNED_SECTIONS,
  architectMeta: DATABASE_ARCHITECT_META
};
