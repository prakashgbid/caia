/**
 * @caia/info-architect — Postgres + in-memory persistence.
 *
 * Two implementations:
 *   - IaPostgresPersistence — real production adapter.
 *   - IaMemoryPersistence   — in-memory adapter for tests and the smoke path.
 *
 * Per-tenant schema layout mirrors `@caia/grand-idea`'s template
 * substitution pattern (`{{SCHEMA}}` placeholder rewritten at apply
 * time). Three tables:
 *   - pages_catalogue   (per-project current pointer + JSONB document)
 *   - design_systems    (same shape; plus template_name for §10 reuse)
 *   - components_library (same shape; GIN index on document->'components')
 *
 * Wave-1 keeps the schema minimal — no parent ia_revisions table; the
 * `revisionId` is column-local. Wave 2 will extract the parent revision
 * table.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InfoArchitectError } from './errors.js';
import type {
  IaInput,
  IaOutput,
  IaPersistence,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default migration template path (resolves to ../migrations/0001_info_architect.sql). */
export const DEFAULT_MIGRATION_PATH = join(
  __dirname,
  '..',
  'migrations',
  '0001_info_architect.sql',
);

/** Minimal pg.Pool surface the persistence layer needs. Avoids hard
 * coupling to the `pg` package at compile-time. */
export interface PgPoolLike {
  query<R = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  connect(): Promise<PgClientLike>;
}

export interface PgClientLike {
  query<R = Record<string, unknown>>(
    text: string,
    params?: ReadonlyArray<unknown>,
  ): Promise<{ rows: R[]; rowCount: number | null }>;
  release(): void;
}

export interface IaPostgresPersistenceOptions {
  readonly pgPool: PgPoolLike;
  readonly tenantSchema: string;
  readonly migrationPath?: string;
  readonly clock?: () => Date;
  /**
   * Provider for an `IaInput` given a project id. Pluggable so we don't
   * own the schema for `BusinessPlanV2` (which lives in
   * @caia/interviewer). In production this would be wired to the
   * interviewer's persistence; in tests it returns a stub.
   */
  readonly readIaInputFn: (projectId: string) => Promise<IaInput | null>;
}

/** Compute the per-tenant schema name from a slug. */
export function tenantSchemaName(tenantSlug: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(tenantSlug)) {
    throw new InfoArchitectError(
      'validation_failed',
      `invalid tenant slug: ${tenantSlug}`,
    );
  }
  const cleaned = tenantSlug.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `caia_${cleaned.slice(0, 24)}`;
}

/** Safely quote a Postgres identifier. */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new InfoArchitectError(
      'validation_failed',
      `invalid SQL identifier: ${name}`,
    );
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export class IaPostgresPersistence implements IaPersistence {
  public readonly tenantSchema: string;
  private readonly pool: PgPoolLike;
  private readonly migrationPath: string;
  private readonly clock: () => Date;
  private readonly quotedSchema: string;
  private readonly readIaInputFn: (projectId: string) => Promise<IaInput | null>;
  private schemaEnsured = false;

  public constructor(opts: IaPostgresPersistenceOptions) {
    this.pool = opts.pgPool;
    this.tenantSchema = opts.tenantSchema;
    this.migrationPath = opts.migrationPath ?? DEFAULT_MIGRATION_PATH;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.quotedSchema = quoteIdent(this.tenantSchema);
    this.readIaInputFn = opts.readIaInputFn;
  }

  /**
   * Apply the info-architect migration.
   *
   * @param overrideSchemaName optional canonical schema name (e.g. from
   * `apps/dashboard/lib/tenants/store.ts::schemaNameForEmail`). When
   * supplied, the migration applies to this schema instead of the
   * constructor-derived `tenantSchema`. Used by
   * `@caia/wizard-tenant-bootstrap` to align all per-tenant packages on
   * the provisioning-canonical `tenant_<safe>_<hash>` name. Backward
   * compatible — existing callers pass nothing and get unchanged behavior.
   */
  public async ensureSchema(overrideSchemaName?: string): Promise<void> {
    const targetSchema = overrideSchemaName ?? this.tenantSchema;
    const targetQuoted = overrideSchemaName ? quoteIdent(overrideSchemaName) : this.quotedSchema;
    if (this.schemaEnsured && targetSchema === this.tenantSchema) return;
    let template: string;
    try {
      template = await readFile(this.migrationPath, 'utf8');
    } catch (err) {
      throw new InfoArchitectError(
        'persistence_failed',
        `failed to read migration template: ${this.migrationPath}`,
        err,
      );
    }
    const sql = template.replace(/\{\{SCHEMA\}\}/g, targetQuoted);
    try {
      await this.pool.query(sql);
      if (targetSchema === this.tenantSchema) this.schemaEnsured = true;
    } catch (err) {
      throw new InfoArchitectError(
        'persistence_failed',
        `failed to apply info-architect migration to ${targetSchema}`,
        err,
      );
    }
  }

  public async readInput(projectId: string): Promise<IaInput | null> {
    try {
      return await this.readIaInputFn(projectId);
    } catch (err) {
      throw new InfoArchitectError(
        'persistence_failed',
        `readIaInputFn failed for project ${projectId}`,
        err,
      );
    }
  }

  public async writeArtifacts(
    projectId: string,
    output: IaOutput,
  ): Promise<{ revisionId: string; writtenAt: string }> {
    await this.ensureSchema();
    const writtenAtDate = this.clock();
    const writtenAt = writtenAtDate.toISOString();
    const revisionId = output.pagesCatalogue.revisionId;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.upsertOne(
        client,
        'pages_catalogue',
        projectId,
        revisionId,
        output.pagesCatalogue,
        writtenAtDate,
      );
      await this.upsertOne(
        client,
        'design_systems',
        projectId,
        revisionId,
        output.designSystem,
        writtenAtDate,
        output.designSystem.templateName,
      );
      await this.upsertOne(
        client,
        'components_library',
        projectId,
        revisionId,
        output.componentsLibrary,
        writtenAtDate,
      );
      await client.query('COMMIT');
      return { revisionId, writtenAt };
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback failure — we'll surface the original error
      }
      throw new InfoArchitectError(
        'persistence_failed',
        'failed to write IA artifacts',
        err,
        { projectId },
      );
    } finally {
      client.release();
    }
  }

  private async upsertOne(
    client: PgClientLike,
    table: 'pages_catalogue' | 'design_systems' | 'components_library',
    projectId: string,
    revisionId: string,
    document: object,
    writtenAt: Date,
    templateName?: string,
  ): Promise<void> {
    const tableIdent = `${this.quotedSchema}.${quoteIdent(table)}`;
    if (table === 'design_systems') {
      await client.query(
        `
        INSERT INTO ${tableIdent}
          (tenant_project_id, current_ia_revision_id, document, template_name, updated_at)
        VALUES ($1::uuid, $2, $3::jsonb, $4, $5)
        ON CONFLICT (tenant_project_id) DO UPDATE
          SET current_ia_revision_id = EXCLUDED.current_ia_revision_id,
              document               = EXCLUDED.document,
              template_name          = EXCLUDED.template_name,
              updated_at             = EXCLUDED.updated_at
        `,
        [projectId, revisionId, JSON.stringify(document), templateName ?? null, writtenAt],
      );
    } else {
      await client.query(
        `
        INSERT INTO ${tableIdent}
          (tenant_project_id, current_ia_revision_id, document, updated_at)
        VALUES ($1::uuid, $2, $3::jsonb, $4)
        ON CONFLICT (tenant_project_id) DO UPDATE
          SET current_ia_revision_id = EXCLUDED.current_ia_revision_id,
              document               = EXCLUDED.document,
              updated_at             = EXCLUDED.updated_at
        `,
        [projectId, revisionId, JSON.stringify(document), writtenAt],
      );
    }
  }

  public async readLatestArtifacts(projectId: string): Promise<IaOutput | null> {
    await this.ensureSchema();
    const pagesSql = `SELECT document FROM ${this.quotedSchema}.pages_catalogue WHERE tenant_project_id = $1::uuid`;
    const dsSql = `SELECT document FROM ${this.quotedSchema}.design_systems WHERE tenant_project_id = $1::uuid`;
    const cmpSql = `SELECT document FROM ${this.quotedSchema}.components_library WHERE tenant_project_id = $1::uuid`;
    const [pagesR, dsR, cmpR] = await Promise.all([
      this.pool.query<{ document: object | string }>(pagesSql, [projectId]),
      this.pool.query<{ document: object | string }>(dsSql, [projectId]),
      this.pool.query<{ document: object | string }>(cmpSql, [projectId]),
    ]);
    if (pagesR.rowCount === 0 || dsR.rowCount === 0 || cmpR.rowCount === 0) {
      return null;
    }
    return {
      pagesCatalogue: parseJsonDoc(pagesR.rows[0]!.document) as IaOutput['pagesCatalogue'],
      designSystem: parseJsonDoc(dsR.rows[0]!.document) as IaOutput['designSystem'],
      componentsLibrary: parseJsonDoc(cmpR.rows[0]!.document) as IaOutput['componentsLibrary'],
    };
  }
}

function parseJsonDoc(d: object | string): object {
  if (typeof d === 'string') return JSON.parse(d) as object;
  return d;
}

// ---------------------------------------------------------------------------
// In-memory implementation for fixtures + unit tests.
// ---------------------------------------------------------------------------

export interface IaMemoryPersistenceOptions {
  readonly tenantSchema?: string;
  readonly clock?: () => Date;
  /** Pre-seed inputs keyed by project id. */
  readonly inputs?: ReadonlyArray<readonly [string, IaInput]>;
}

interface MemoryRow {
  readonly projectId: string;
  readonly revisionId: string;
  readonly writtenAt: string;
  readonly output: IaOutput;
}

export class IaMemoryPersistence implements IaPersistence {
  public readonly tenantSchema: string;
  private readonly clock: () => Date;
  private readonly inputs = new Map<string, IaInput>();
  private readonly rows: MemoryRow[] = [];

  public constructor(opts: IaMemoryPersistenceOptions = {}) {
    this.tenantSchema = opts.tenantSchema ?? 'caia_memtest';
    this.clock = opts.clock ?? ((): Date => new Date());
    if (opts.inputs) {
      for (const [id, input] of opts.inputs) this.inputs.set(id, input);
    }
  }

  public async ensureSchema(): Promise<void> {
    // No-op for in-memory.
  }

  public async readInput(projectId: string): Promise<IaInput | null> {
    return this.inputs.get(projectId) ?? null;
  }

  public seedInput(projectId: string, input: IaInput): void {
    this.inputs.set(projectId, input);
  }

  public async writeArtifacts(
    projectId: string,
    output: IaOutput,
  ): Promise<{ revisionId: string; writtenAt: string }> {
    const revisionId = output.pagesCatalogue.revisionId;
    const writtenAt = this.clock().toISOString();
    // Idempotent: overwrite by projectId — production writes the
    // current-pointer; per-revision history lives in the deferred
    // ia_revisions table (Wave 2).
    const existingIdx = this.rows.findIndex((r) => r.projectId === projectId);
    const row: MemoryRow = { projectId, revisionId, writtenAt, output };
    if (existingIdx >= 0) {
      this.rows[existingIdx] = row;
    } else {
      this.rows.push(row);
    }
    return { revisionId, writtenAt };
  }

  public async readLatestArtifacts(projectId: string): Promise<IaOutput | null> {
    const r = this.rows.find((x) => x.projectId === projectId);
    return r ? r.output : null;
  }

  /** Test helper: list all persisted rows. */
  public listRows(): readonly MemoryRow[] {
    return [...this.rows];
  }
}
