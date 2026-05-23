/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Database's contributions so the
 * Reviewer's `invariants-registry.ts` (which doesn't exist yet — sibling
 * brief F2) can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'database.tables'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `database.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Database package's own tests AND
 * inside the Reviewer's post-composition pass.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  /** Architect that contributed this invariant. */
  contributor: string;
  /** Other architects whose fields this invariant reads. */
  reads: readonly string[];
  /** Severity if the predicate returns false. */
  severity: InvariantSeverity;
  /** Operator-facing description for the Reviewer's audit log. */
  description: string;
  /**
   * The predicate. Receives the JSONB blob (flat-keyed
   * `architectureFields` view OR nested composed-architecture view).
   * Pure + synchronous.
   */
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

/**
 * Read a field from the architecture blob. Tries the flat dotted key
 * first (matches `architectureFields` shape), then falls back to walking
 * the nested object path (matches composed-architecture shape).
 */
function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

function asArray(v: unknown): readonly unknown[] | null {
  return Array.isArray(v) ? v : null;
}

function asObject(v: unknown): Readonly<Record<string, unknown>> | null {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return null;
  return v as Readonly<Record<string, unknown>>;
}

/**
 * Database's contributed invariants. Listed in stable order.
 */
export const DATABASE_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'database.tables-nonempty',
    contributor: 'database',
    reads: ['database.tables'],
    severity: 'fail',
    description:
      'Every Database output must declare at least one table. An empty `tables` array means the architect failed to project the persistence touchpoints.',
    detect(arch): boolean {
      const tables = asArray(readField(arch, 'database.tables'));
      return tables !== null && tables.length > 0;
    }
  },
  {
    id: 'database.engine-is-postgres',
    contributor: 'database',
    reads: ['database.engine'],
    severity: 'fail',
    description:
      'The locked stack mandates Postgres 16. Any engine decision other than Postgres is a hard violation.',
    detect(arch): boolean {
      const engine = asObject(readField(arch, 'database.engine'));
      if (!engine) return false;
      return engine.name === 'postgres';
    }
  },
  {
    id: 'database.tenant-isolation-declared',
    contributor: 'database',
    reads: ['database.tenantIsolationStrategy'],
    severity: 'fail',
    description:
      'Every Database output must declare a tenantIsolationStrategy with a recognised model (schema-per-tenant|row-level|hybrid).',
    detect(arch): boolean {
      const t = asObject(readField(arch, 'database.tenantIsolationStrategy'));
      if (!t) return false;
      return t.model === 'schema-per-tenant' || t.model === 'row-level' || t.model === 'hybrid';
    }
  },
  {
    id: 'database.every-table-has-columns',
    contributor: 'database',
    reads: ['database.tables', 'database.columns'],
    severity: 'fail',
    description:
      'Every table declared in `tables` must have a matching entry in `columns`. Tables without columns cannot be created.',
    detect(arch): boolean {
      const tables = asArray(readField(arch, 'database.tables'));
      const columns = asObject(readField(arch, 'database.columns'));
      if (!tables || !columns) return false;
      for (const t of tables) {
        const table = asObject(t);
        if (!table || typeof table.name !== 'string') return false;
        if (!(table.name in columns)) return false;
      }
      return true;
    }
  },
  {
    id: 'database.every-table-has-id-and-timestamps',
    contributor: 'database',
    reads: ['database.columns'],
    severity: 'advisory',
    description:
      'Every table should declare an `id` primary key plus `created_at` and `updated_at` timestamptz columns per the locked stack.',
    detect(arch): boolean {
      const columns = asObject(readField(arch, 'database.columns'));
      if (!columns) return false;
      for (const [, colList] of Object.entries(columns)) {
        const cols = asArray(colList);
        if (!cols) return false;
        const names = new Set<string>();
        for (const c of cols) {
          const obj = asObject(c);
          if (obj && typeof obj.name === 'string') names.add(obj.name);
        }
        if (!names.has('id')) return false;
        if (!names.has('created_at')) return false;
        if (!names.has('updated_at')) return false;
      }
      return true;
    }
  },
  {
    id: 'database.migrations-have-up-and-down',
    contributor: 'database',
    reads: ['database.migrations'],
    severity: 'fail',
    description:
      'Every migration must declare both `up` and `down` DDL. Missing either makes rollback impossible.',
    detect(arch): boolean {
      const migs = asArray(readField(arch, 'database.migrations'));
      if (!migs) return false;
      for (const m of migs) {
        const obj = asObject(m);
        if (!obj) return false;
        if (typeof obj.up !== 'string' || obj.up.length === 0) return false;
        if (typeof obj.down !== 'string' || obj.down.length === 0) return false;
      }
      return true;
    }
  },
  {
    id: 'database.rls-policies-cover-tenant-scoped-tables',
    contributor: 'database',
    reads: ['database.tables', 'database.rlsPolicies'],
    severity: 'fail',
    description:
      'Every tenant-scoped table MUST have at least one RLS policy declared. RLS is mandatory under the locked stack — defence in depth even under schema-per-tenant.',
    detect(arch): boolean {
      const tables = asArray(readField(arch, 'database.tables'));
      const rls = asObject(readField(arch, 'database.rlsPolicies'));
      if (!tables || !rls) return false;
      for (const t of tables) {
        const table = asObject(t);
        if (!table || typeof table.name !== 'string') continue;
        if (table.scope !== 'tenant') continue;
        const policies = asArray(rls[table.name]);
        if (!policies || policies.length === 0) return false;
      }
      return true;
    }
  },
  {
    id: 'database.jsonb-columns-have-shapes',
    contributor: 'database',
    reads: ['database.columns', 'database.jsonbShapes'],
    severity: 'advisory',
    description:
      'Every JSONB column should have a matching Zod-style descriptor in `jsonbShapes`. Schema-less JSONB is a code smell.',
    detect(arch): boolean {
      const columns = asObject(readField(arch, 'database.columns'));
      const shapes = asObject(readField(arch, 'database.jsonbShapes'));
      if (!columns) return false;
      const shapeKeys = new Set(shapes ? Object.keys(shapes) : []);
      for (const [tableName, colList] of Object.entries(columns)) {
        const cols = asArray(colList);
        if (!cols) continue;
        for (const c of cols) {
          const obj = asObject(c);
          if (!obj) continue;
          if (obj.type === 'jsonb' && typeof obj.name === 'string') {
            const key = `${tableName}.${obj.name}`;
            if (!shapeKeys.has(key)) return false;
          }
        }
      }
      return true;
    }
  },
  {
    id: 'database.fk-columns-have-btree-indexes',
    contributor: 'database',
    reads: ['database.relationships', 'database.indexes'],
    severity: 'advisory',
    description:
      'Postgres does not auto-index FK child columns. Every relationship in `relationships` should have a matching B-tree index in `indexes` on the child column.',
    detect(arch): boolean {
      const rels = asArray(readField(arch, 'database.relationships'));
      const indexes = asArray(readField(arch, 'database.indexes'));
      if (!rels || !indexes) return false;
      // Index lookup keyed by `${table}.${col}` → method.
      const idx = new Map<string, string>();
      for (const i of indexes) {
        const obj = asObject(i);
        if (!obj) continue;
        const t = obj.table;
        const cols = asArray(obj.columns);
        const method = typeof obj.method === 'string' ? obj.method : 'btree';
        if (typeof t === 'string' && cols) {
          for (const c of cols) {
            if (typeof c === 'string') idx.set(`${t}.${c}`, method);
          }
        }
      }
      for (const r of rels) {
        const obj = asObject(r);
        if (!obj) continue;
        const from = obj.from;
        if (typeof from !== 'string') return false;
        const key = from;
        const method = idx.get(key);
        if (method !== 'btree') return false;
      }
      return true;
    }
  },
  {
    id: 'database.every-table-has-lifecycle-rule',
    contributor: 'database',
    reads: ['database.tables', 'database.dataLifecycle'],
    severity: 'advisory',
    description:
      'Every table should have a matching entry in `dataLifecycle` declaring retention + archival + GDPR delete strategy. Missing entries block the data-deletion runbook.',
    detect(arch): boolean {
      const tables = asArray(readField(arch, 'database.tables'));
      const lifecycle = asArray(readField(arch, 'database.dataLifecycle'));
      if (!tables || !lifecycle) return false;
      const known = new Set<string>();
      for (const l of lifecycle) {
        const obj = asObject(l);
        if (obj && typeof obj.table === 'string') known.add(obj.table);
      }
      for (const t of tables) {
        const obj = asObject(t);
        if (!obj || typeof obj.name !== 'string') continue;
        if (!known.has(obj.name)) return false;
      }
      return true;
    }
  }
];
