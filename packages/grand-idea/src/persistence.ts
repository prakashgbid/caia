/**
 * @caia/grand-idea — Postgres persistence.
 *
 * Two implementations live here:
 *   - `GrandIdeaPersistence`        Postgres-backed (production)
 *   - `MemoryGrandIdeaPersistence`  in-memory (tests + smoke)
 *
 * Both implement the same `IGrandIdeaPersistence` interface so callers
 * can swap freely. Production wires the real `pg.Pool`; tests pass the
 * in-memory implementation.
 */

import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GrandIdeaError } from './errors.js';
import {
  GRAND_IDEA_WORD_CEILING,
  GRAND_IDEA_WORD_FLOOR,
  type GrandIdeaRow,
  type PgPoolLike,
  type TenantRecord,
  computeWordCount,
} from './types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Default migration template path (resolves to ../migrations/001_grand_ideas.sql). */
export const DEFAULT_MIGRATION_PATH = join(__dirname, '..', 'migrations', '001_grand_ideas.sql');

/** Persistence interface — both implementations conform. */
export interface IGrandIdeaPersistence {
  readonly tenantSchema: string;
  ensureSchema(): Promise<void>;
  readTenant(tenantSlug: string): Promise<TenantRecord | null>;
  readLatestGrandIdea(projectId: string): Promise<GrandIdeaRow | null>;
  writeGrandIdea(input: WriteGrandIdeaInput): Promise<GrandIdeaRow>;
}

export interface WriteGrandIdeaInput {
  tenantSlug: string;
  projectId: string;
  prompt: string;
  capturedBy: string;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface GrandIdeaPersistenceOptions {
  pgPool: PgPoolLike;
  tenantSchema: string;
  metaSchema?: string;
  migrationPath?: string;
  clock?: () => Date;
}

/** Compute the per-tenant schema name from a slug (mirrors interviewer convention). */
export function tenantSchemaName(tenantSlug: string): string {
  if (!/^[a-z0-9][a-z0-9_-]*$/i.test(tenantSlug)) {
    throw new GrandIdeaError('validation_failed', `invalid tenant slug: ${tenantSlug}`);
  }
  const cleaned = tenantSlug.toLowerCase().replace(/[^a-z0-9]/g, '_');
  return `caia_${cleaned.slice(0, 24)}`;
}

/** Quote a Postgres identifier safely (used for schema name substitution). */
function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new GrandIdeaError('validation_failed', `invalid SQL identifier: ${name}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export class GrandIdeaPersistence implements IGrandIdeaPersistence {
  public readonly tenantSchema: string;
  private readonly pool: PgPoolLike;
  private readonly metaSchema: string;
  private readonly migrationPath: string;
  private readonly clock: () => Date;
  private readonly quotedSchema: string;
  private schemaEnsured = false;

  public constructor(opts: GrandIdeaPersistenceOptions) {
    this.pool = opts.pgPool;
    this.tenantSchema = opts.tenantSchema;
    this.metaSchema = opts.metaSchema ?? 'caia_meta';
    this.migrationPath = opts.migrationPath ?? DEFAULT_MIGRATION_PATH;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.quotedSchema = quoteIdent(this.tenantSchema);
  }

  public async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;
    const template = await readFile(this.migrationPath, 'utf8');
    const sql = template.replace(/\{\{SCHEMA\}\}/g, this.quotedSchema);
    try {
      await this.pool.query(sql);
      this.schemaEnsured = true;
    } catch (err) {
      throw new GrandIdeaError(
        'persistence_failed',
        `failed to apply grand-ideas migration to ${this.tenantSchema}`,
        err,
      );
    }
  }

  public async readTenant(tenantSlug: string): Promise<TenantRecord | null> {
    const sql = `
      SELECT id::text                AS id,
             slug                    AS slug,
             COALESCE(schema_name,'') AS schema_name,
             onboarding_complete     AS onboarding_complete
        FROM ${quoteIdent(this.metaSchema)}.tenants
       WHERE slug = $1
       LIMIT 1
    `;
    const r = await this.pool.query<{
      id: string;
      slug: string;
      schema_name: string;
      onboarding_complete: boolean;
    }>(sql, [tenantSlug]);
    if (r.rowCount === 0) return null;
    const row = r.rows[0]!;
    return {
      id: row.id,
      slug: row.slug,
      schemaName: row.schema_name,
      onboardingComplete: row.onboarding_complete,
    };
  }

  public async readLatestGrandIdea(projectId: string): Promise<GrandIdeaRow | null> {
    await this.ensureSchema();
    const sql = `
      SELECT id::text             AS id,
             tenant_slug          AS tenant_slug,
             project_id::text     AS project_id,
             revision_number      AS revision_number,
             prompt               AS prompt,
             prompt_word_count    AS prompt_word_count,
             captured_by          AS captured_by,
             captured_at          AS captured_at,
             metadata             AS metadata
        FROM ${this.quotedSchema}.grand_ideas
       WHERE project_id = $1::uuid
       ORDER BY revision_number DESC
       LIMIT 1
    `;
    const r = await this.pool.query<GrandIdeaRowDb>(sql, [projectId]);
    if (r.rowCount === 0) return null;
    return dbRowToGrandIdea(r.rows[0]!);
  }

  public async writeGrandIdea(input: WriteGrandIdeaInput): Promise<GrandIdeaRow> {
    await this.ensureSchema();
    const wordCount = computeWordCount(input.prompt);
    if (wordCount < GRAND_IDEA_WORD_FLOOR) {
      throw new GrandIdeaError(
        'validation_failed',
        `prompt is too short (${wordCount} words; floor is ${GRAND_IDEA_WORD_FLOOR})`,
        undefined,
        { wordCount, floor: GRAND_IDEA_WORD_FLOOR },
      );
    }
    if (wordCount > GRAND_IDEA_WORD_CEILING) {
      throw new GrandIdeaError(
        'validation_failed',
        `prompt is too long (${wordCount} words; ceiling is ${GRAND_IDEA_WORD_CEILING})`,
        undefined,
        { wordCount, ceiling: GRAND_IDEA_WORD_CEILING },
      );
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Compute next revision number under FOR UPDATE lock to prevent race.
      const r = await client.query<{ next_rev: number }>(
        `
        SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_rev
          FROM ${this.quotedSchema}.grand_ideas
         WHERE project_id = $1::uuid
         FOR UPDATE
        `,
        [input.projectId],
      );
      const nextRev = Number(r.rows[0]?.next_rev ?? 1);
      const now = this.clock();
      const insert = await client.query<GrandIdeaRowDb>(
        `
        INSERT INTO ${this.quotedSchema}.grand_ideas
          (tenant_slug, project_id, revision_number, prompt, prompt_word_count,
           captured_by, captured_at, metadata)
        VALUES ($1, $2::uuid, $3, $4, $5, $6, $7, $8::jsonb)
        RETURNING id::text            AS id,
                  tenant_slug         AS tenant_slug,
                  project_id::text    AS project_id,
                  revision_number     AS revision_number,
                  prompt              AS prompt,
                  prompt_word_count   AS prompt_word_count,
                  captured_by         AS captured_by,
                  captured_at         AS captured_at,
                  metadata            AS metadata
        `,
        [
          input.tenantSlug,
          input.projectId,
          nextRev,
          input.prompt,
          wordCount,
          input.capturedBy,
          now,
          JSON.stringify(input.metadata ?? {}),
        ],
      );
      await client.query('COMMIT');
      return dbRowToGrandIdea(insert.rows[0]!);
    } catch (err) {
      try {
        await client.query('ROLLBACK');
      } catch {
        /* ignore rollback failure */
      }
      throw new GrandIdeaError(
        'persistence_failed',
        'failed to write grand-idea row',
        err,
        { projectId: input.projectId },
      );
    } finally {
      client.release();
    }
  }
}

// --------------------------------------------------------------------------
// In-memory implementation for fixtures + unit tests.
// --------------------------------------------------------------------------

export interface MemoryPersistenceOptions {
  tenantSchema?: string;
  clock?: () => Date;
  /** Pre-seed the meta tenants list. */
  tenants?: TenantRecord[];
}

export class MemoryGrandIdeaPersistence implements IGrandIdeaPersistence {
  public readonly tenantSchema: string;
  private readonly clock: () => Date;
  private readonly rows: GrandIdeaRow[] = [];
  private readonly tenants: TenantRecord[];
  private nextRowId = 1;

  public constructor(opts: MemoryPersistenceOptions = {}) {
    this.tenantSchema = opts.tenantSchema ?? 'caia_memtest';
    this.clock = opts.clock ?? ((): Date => new Date());
    this.tenants = [...(opts.tenants ?? [])];
  }

  public async ensureSchema(): Promise<void> {
    // No-op for in-memory.
  }

  public async readTenant(tenantSlug: string): Promise<TenantRecord | null> {
    return this.tenants.find((t) => t.slug === tenantSlug) ?? null;
  }

  public addTenant(tenant: TenantRecord): void {
    const existing = this.tenants.findIndex((t) => t.slug === tenant.slug);
    if (existing >= 0) {
      this.tenants[existing] = tenant;
    } else {
      this.tenants.push(tenant);
    }
  }

  public async readLatestGrandIdea(projectId: string): Promise<GrandIdeaRow | null> {
    const matches = this.rows.filter((r) => r.projectId === projectId);
    if (matches.length === 0) return null;
    matches.sort((a, b) => b.revisionNumber - a.revisionNumber);
    return matches[0] ?? null;
  }

  public async writeGrandIdea(input: WriteGrandIdeaInput): Promise<GrandIdeaRow> {
    const wordCount = computeWordCount(input.prompt);
    if (wordCount < GRAND_IDEA_WORD_FLOOR) {
      throw new GrandIdeaError(
        'validation_failed',
        `prompt is too short (${wordCount} words; floor is ${GRAND_IDEA_WORD_FLOOR})`,
        undefined,
        { wordCount, floor: GRAND_IDEA_WORD_FLOOR },
      );
    }
    if (wordCount > GRAND_IDEA_WORD_CEILING) {
      throw new GrandIdeaError(
        'validation_failed',
        `prompt is too long (${wordCount} words; ceiling is ${GRAND_IDEA_WORD_CEILING})`,
        undefined,
        { wordCount, ceiling: GRAND_IDEA_WORD_CEILING },
      );
    }
    const latest = await this.readLatestGrandIdea(input.projectId);
    const nextRev = (latest?.revisionNumber ?? 0) + 1;
    const row: GrandIdeaRow = {
      id: `mem-${this.nextRowId++}`,
      tenantSlug: input.tenantSlug,
      projectId: input.projectId,
      revisionNumber: nextRev,
      prompt: input.prompt,
      promptWordCount: wordCount,
      capturedBy: input.capturedBy,
      capturedAtIso: this.clock().toISOString(),
      metadata: Object.freeze({ ...(input.metadata ?? {}) }),
    };
    this.rows.push(row);
    return row;
  }

  /** Test helper: read all rows. */
  public listRows(): readonly GrandIdeaRow[] {
    return [...this.rows];
  }
}

// --------------------------------------------------------------------------
// Internal helpers
// --------------------------------------------------------------------------

interface GrandIdeaRowDb {
  id: string;
  tenant_slug: string;
  project_id: string;
  revision_number: number | string;
  prompt: string;
  prompt_word_count: number | string;
  captured_by: string;
  captured_at: Date | string;
  metadata: Record<string, unknown> | string | null;
}

function dbRowToGrandIdea(row: GrandIdeaRowDb): GrandIdeaRow {
  const captured = row.captured_at instanceof Date
    ? row.captured_at.toISOString()
    : new Date(row.captured_at).toISOString();
  let metadata: Record<string, unknown>;
  if (row.metadata === null || row.metadata === undefined) metadata = {};
  else if (typeof row.metadata === 'string') {
    try { metadata = JSON.parse(row.metadata) as Record<string, unknown>; }
    catch { metadata = {}; }
  } else metadata = row.metadata;
  return {
    id: row.id,
    tenantSlug: row.tenant_slug,
    projectId: row.project_id,
    revisionNumber: Number(row.revision_number),
    prompt: row.prompt,
    promptWordCount: Number(row.prompt_word_count),
    capturedBy: row.captured_by,
    capturedAtIso: captured,
    metadata: Object.freeze(metadata),
  };
}
