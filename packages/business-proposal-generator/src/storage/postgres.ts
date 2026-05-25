/**
 * Postgres persistence for business_proposals + designapp_prompts +
 * proposal_revisions. All three tables written in a single transaction.
 *
 * Two implementations: real (pg.Pool) and in-memory.
 */

import { ProposalGeneratorError } from '../errors.js';
import type {
  BusinessProposalRow,
  DesignAppPromptRow,
  FormatsManifest,
  ProposalRevisionRow,
  TargetName,
} from '../types/proposal.js';

export interface PgQueryRunner {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
}
export interface PgPoolLike {
  query<R = unknown>(text: string, values?: unknown[]): Promise<{ rows: R[]; rowCount: number }>;
  connect(): Promise<PgClient>;
}
export interface PgClient extends PgQueryRunner {
  release(err?: Error | boolean): void;
}

export interface WriteRevisionInput {
  tenantProjectId: string;
  businessPlanHash: string;
  execSummaryMd: string;
  fullProposalMd: string;
  onePagerMd: string;
  formatsManifest: FormatsManifest;
  docHost: BusinessProposalRow['docHost'];
  docHostUrls: BusinessProposalRow['docHostUrls'];
  designAppPrompt: {
    target: TargetName;
    promptText: string;
    promptMetadata: Readonly<Record<string, unknown>>;
    reviewerScore: number;
    reviewerFindings: Readonly<Record<string, unknown>>;
    reviewerBadge: 'ship' | 'caution';
  };
  parentRevisionId: string | null;
  reason: string | null;
  diffSummary: Readonly<Record<string, unknown>> | null;
}

export interface WriteRevisionResult {
  proposal: BusinessProposalRow;
  prompt: DesignAppPromptRow;
  revision: ProposalRevisionRow;
}

export interface IProposalPersistence {
  readonly tenantSchema: string;
  ensureSchema(): Promise<void>;
  readLatestProposal(tenantProjectId: string): Promise<BusinessProposalRow | null>;
  writeRevision(input: WriteRevisionInput): Promise<WriteRevisionResult>;
}

function quoteIdent(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new ProposalGeneratorError('validation_failed', `invalid SQL identifier: ${name}`);
  }
  return `"${name.replace(/"/g, '""')}"`;
}

export interface PgPersistenceOptions {
  pgPool: PgPoolLike;
  tenantSchema: string;
  clock?: () => Date;
  migrationSql?: string;
}

export class PgProposalPersistence implements IProposalPersistence {
  public readonly tenantSchema: string;
  private readonly pool: PgPoolLike;
  private readonly clock: () => Date;
  private readonly quoted: string;
  private readonly migrationSql: string | null;
  private schemaEnsured = false;

  public constructor(opts: PgPersistenceOptions) {
    this.pool = opts.pgPool;
    this.tenantSchema = opts.tenantSchema;
    this.clock = opts.clock ?? ((): Date => new Date());
    this.quoted = quoteIdent(this.tenantSchema);
    this.migrationSql = opts.migrationSql ?? null;
  }

  public async ensureSchema(): Promise<void> {
    if (this.schemaEnsured) return;
    if (this.migrationSql) {
      const sql = this.migrationSql.replace(/\{\{SCHEMA\}\}/g, this.quoted);
      await this.pool.query(sql);
    }
    this.schemaEnsured = true;
  }

  public async readLatestProposal(tenantProjectId: string): Promise<BusinessProposalRow | null> {
    await this.ensureSchema();
    const sql = `
      SELECT id::text AS id, tenant_project_id::text AS tenant_project_id,
             revision_number AS revision_number, business_plan_hash AS business_plan_hash,
             exec_summary_md, full_proposal_md, one_pager_md,
             formats_manifest AS formats_manifest, doc_host, doc_host_urls AS doc_host_urls,
             generated_at AS generated_at, generator_run_id::text AS generator_run_id, status
        FROM ${this.quoted}.business_proposals
       WHERE tenant_project_id = $1::uuid
       ORDER BY revision_number DESC
       LIMIT 1
    `;
    const r = await this.pool.query<RowDb>(sql, [tenantProjectId]);
    if (r.rowCount === 0) return null;
    return dbRowToProposal(r.rows[0]!);
  }

  public async writeRevision(input: WriteRevisionInput): Promise<WriteRevisionResult> {
    await this.ensureSchema();
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const nextR = await client.query<{ next_rev: number }>(
        `SELECT COALESCE(MAX(revision_number),0)+1 AS next_rev
           FROM ${this.quoted}.business_proposals
          WHERE tenant_project_id = $1::uuid FOR UPDATE`,
        [input.tenantProjectId],
      );
      const nextRev = Number(nextR.rows[0]?.next_rev ?? 1);
      const now = this.clock();

      const propIns = await client.query<RowDb>(
        `INSERT INTO ${this.quoted}.business_proposals
           (tenant_project_id, revision_number, business_plan_hash,
            exec_summary_md, full_proposal_md, one_pager_md,
            formats_manifest, doc_host, doc_host_urls, generated_at, status)
         VALUES ($1::uuid,$2,$3,$4,$5,$6,$7::jsonb,$8,$9::jsonb,$10,'draft')
         RETURNING id::text AS id, tenant_project_id::text AS tenant_project_id,
                   revision_number, business_plan_hash, exec_summary_md, full_proposal_md,
                   one_pager_md, formats_manifest, doc_host, doc_host_urls,
                   generated_at, generator_run_id::text AS generator_run_id, status`,
        [
          input.tenantProjectId,
          nextRev,
          input.businessPlanHash,
          input.execSummaryMd,
          input.fullProposalMd,
          input.onePagerMd,
          JSON.stringify(input.formatsManifest),
          input.docHost,
          input.docHostUrls ? JSON.stringify(input.docHostUrls) : null,
          now,
        ],
      );
      const proposal = dbRowToProposal(propIns.rows[0]!);

      // Mark prior prompt(s) as superseded.
      if (input.parentRevisionId !== null) {
        await client.query(
          `UPDATE ${this.quoted}.designapp_prompts dp
              SET superseded_by = $1::uuid
            WHERE business_proposal_id IN (
              SELECT business_proposal_id FROM ${this.quoted}.proposal_revisions
               WHERE id = $2::uuid
            )
              AND superseded_by IS NULL`,
          [proposal.id, input.parentRevisionId],
        );
      }

      const promptIns = await client.query<PromptRowDb>(
        `INSERT INTO ${this.quoted}.designapp_prompts
           (business_proposal_id, target, prompt_text, prompt_metadata,
            reviewer_score, reviewer_findings, reviewer_badge, generated_at)
         VALUES ($1::uuid,$2,$3,$4::jsonb,$5,$6::jsonb,$7,$8)
         RETURNING id::text AS id, business_proposal_id::text AS business_proposal_id,
                   target, prompt_text, prompt_metadata, reviewer_score,
                   reviewer_findings, reviewer_badge, generated_at,
                   generator_run_id::text AS generator_run_id,
                   superseded_by::text AS superseded_by`,
        [
          proposal.id,
          input.designAppPrompt.target,
          input.designAppPrompt.promptText,
          JSON.stringify(input.designAppPrompt.promptMetadata),
          input.designAppPrompt.reviewerScore,
          JSON.stringify(input.designAppPrompt.reviewerFindings),
          input.designAppPrompt.reviewerBadge,
          now,
        ],
      );
      const prompt = dbRowToPrompt(promptIns.rows[0]!);

      const revIns = await client.query<RevisionRowDb>(
        `INSERT INTO ${this.quoted}.proposal_revisions
           (tenant_project_id, revision_number, business_proposal_id,
            parent_revision_id, reason, diff_summary, created_at)
         VALUES ($1::uuid,$2,$3::uuid,$4::uuid,$5,$6::jsonb,$7)
         RETURNING id::text AS id, tenant_project_id::text AS tenant_project_id,
                   revision_number, business_proposal_id::text AS business_proposal_id,
                   parent_revision_id::text AS parent_revision_id, reason,
                   diff_summary, created_at`,
        [
          input.tenantProjectId,
          nextRev,
          proposal.id,
          input.parentRevisionId,
          input.reason,
          input.diffSummary ? JSON.stringify(input.diffSummary) : null,
          now,
        ],
      );
      const revision = dbRowToRevision(revIns.rows[0]!);

      await client.query('COMMIT');
      return { proposal, prompt, revision };
    } catch (err) {
      try { await client.query('ROLLBACK'); } catch { /* ignore */ }
      throw new ProposalGeneratorError(
        'persistence_failed',
        'failed to write proposal revision',
        err,
        { tenantProjectId: input.tenantProjectId },
      );
    } finally {
      client.release();
    }
  }
}

// ---------- In-memory implementation ----------

export class MemoryProposalPersistence implements IProposalPersistence {
  public readonly tenantSchema: string;
  private readonly clock: () => Date;
  private readonly proposals: BusinessProposalRow[] = [];
  private readonly prompts: DesignAppPromptRow[] = [];
  private readonly revisions: ProposalRevisionRow[] = [];
  private nextId = 1;

  public constructor(opts: { tenantSchema?: string; clock?: () => Date } = {}) {
    this.tenantSchema = opts.tenantSchema ?? 'caia_memtest';
    this.clock = opts.clock ?? ((): Date => new Date());
  }

  public async ensureSchema(): Promise<void> {}

  public async readLatestProposal(tenantProjectId: string): Promise<BusinessProposalRow | null> {
    const list = this.proposals.filter((p) => p.tenantProjectId === tenantProjectId);
    if (list.length === 0) return null;
    list.sort((a, b) => b.revisionNumber - a.revisionNumber);
    return list[0] ?? null;
  }

  public async writeRevision(input: WriteRevisionInput): Promise<WriteRevisionResult> {
    const latest = await this.readLatestProposal(input.tenantProjectId);
    const nextRev = (latest?.revisionNumber ?? 0) + 1;
    const now = this.clock();
    const proposal: BusinessProposalRow = {
      id: `mem-prop-${this.nextId++}`,
      tenantProjectId: input.tenantProjectId,
      revisionNumber: nextRev,
      businessPlanHash: input.businessPlanHash,
      execSummaryMd: input.execSummaryMd,
      fullProposalMd: input.fullProposalMd,
      onePagerMd: input.onePagerMd,
      formatsManifest: input.formatsManifest,
      docHost: input.docHost,
      docHostUrls: input.docHostUrls,
      generatedAtIso: now.toISOString(),
      generatorRunId: null,
      status: 'draft',
    };
    this.proposals.push(proposal);

    // Supersede prior prompt for the parent revision.
    if (input.parentRevisionId !== null) {
      const parent = this.revisions.find((r) => r.id === input.parentRevisionId);
      if (parent) {
        for (const p of this.prompts) {
          if (p.businessProposalId === parent.businessProposalId && p.supersededBy === null) {
            p.supersededBy = proposal.id;
          }
        }
      }
    }

    const prompt: DesignAppPromptRow = {
      id: `mem-prompt-${this.nextId++}`,
      businessProposalId: proposal.id,
      target: input.designAppPrompt.target,
      promptText: input.designAppPrompt.promptText,
      promptMetadata: Object.freeze({ ...input.designAppPrompt.promptMetadata }),
      reviewerScore: input.designAppPrompt.reviewerScore,
      reviewerFindings: Object.freeze({ ...input.designAppPrompt.reviewerFindings }),
      reviewerBadge: input.designAppPrompt.reviewerBadge,
      generatedAtIso: now.toISOString(),
      generatorRunId: null,
      supersededBy: null,
    };
    this.prompts.push(prompt);

    const revision: ProposalRevisionRow = {
      id: `mem-rev-${this.nextId++}`,
      tenantProjectId: input.tenantProjectId,
      revisionNumber: nextRev,
      businessProposalId: proposal.id,
      parentRevisionId: input.parentRevisionId,
      reason: input.reason,
      diffSummary: input.diffSummary,
      createdAtIso: now.toISOString(),
    };
    this.revisions.push(revision);

    return { proposal, prompt, revision };
  }

  public listProposals(): readonly BusinessProposalRow[] { return [...this.proposals]; }
  public listPrompts(): readonly DesignAppPromptRow[] { return [...this.prompts]; }
  public listRevisions(): readonly ProposalRevisionRow[] { return [...this.revisions]; }
}

// ---------- DB row helpers ----------

interface RowDb {
  id: string;
  tenant_project_id: string;
  revision_number: number | string;
  business_plan_hash: string;
  exec_summary_md: string;
  full_proposal_md: string;
  one_pager_md: string;
  formats_manifest: unknown;
  doc_host: string | null;
  doc_host_urls: unknown;
  generated_at: Date | string;
  generator_run_id: string | null;
  status: string;
}

interface PromptRowDb {
  id: string;
  business_proposal_id: string;
  target: string;
  prompt_text: string;
  prompt_metadata: unknown;
  reviewer_score: number | string | null;
  reviewer_findings: unknown;
  reviewer_badge: string | null;
  generated_at: Date | string;
  generator_run_id: string | null;
  superseded_by: string | null;
}

interface RevisionRowDb {
  id: string;
  tenant_project_id: string;
  revision_number: number | string;
  business_proposal_id: string;
  parent_revision_id: string | null;
  reason: string | null;
  diff_summary: unknown;
  created_at: Date | string;
}

function asIso(d: Date | string): string {
  return d instanceof Date ? d.toISOString() : new Date(d).toISOString();
}

function asObj(v: unknown): Record<string, unknown> {
  if (v === null || v === undefined) return {};
  if (typeof v === 'string') {
    try { return JSON.parse(v) as Record<string, unknown>; } catch { return {}; }
  }
  return v as Record<string, unknown>;
}

function dbRowToProposal(r: RowDb): BusinessProposalRow {
  return {
    id: r.id,
    tenantProjectId: r.tenant_project_id,
    revisionNumber: Number(r.revision_number),
    businessPlanHash: r.business_plan_hash,
    execSummaryMd: r.exec_summary_md,
    fullProposalMd: r.full_proposal_md,
    onePagerMd: r.one_pager_md,
    formatsManifest: asObj(r.formats_manifest) as FormatsManifest,
    docHost: (r.doc_host as BusinessProposalRow['docHost']) ?? null,
    docHostUrls: r.doc_host_urls ? (asObj(r.doc_host_urls) as Record<string, string>) : null,
    generatedAtIso: asIso(r.generated_at),
    generatorRunId: r.generator_run_id ?? null,
    status: (r.status as BusinessProposalRow['status']) ?? 'draft',
  };
}

function dbRowToPrompt(r: PromptRowDb): DesignAppPromptRow {
  return {
    id: r.id,
    businessProposalId: r.business_proposal_id,
    target: r.target as TargetName,
    promptText: r.prompt_text,
    promptMetadata: Object.freeze(asObj(r.prompt_metadata)),
    reviewerScore: r.reviewer_score === null ? null : Number(r.reviewer_score),
    reviewerFindings: r.reviewer_findings ? Object.freeze(asObj(r.reviewer_findings)) : null,
    reviewerBadge: (r.reviewer_badge as DesignAppPromptRow['reviewerBadge']) ?? null,
    generatedAtIso: asIso(r.generated_at),
    generatorRunId: r.generator_run_id ?? null,
    supersededBy: r.superseded_by ?? null,
  };
}

function dbRowToRevision(r: RevisionRowDb): ProposalRevisionRow {
  return {
    id: r.id,
    tenantProjectId: r.tenant_project_id,
    revisionNumber: Number(r.revision_number),
    businessProposalId: r.business_proposal_id,
    parentRevisionId: r.parent_revision_id ?? null,
    reason: r.reason ?? null,
    diffSummary: r.diff_summary ? Object.freeze(asObj(r.diff_summary)) : null,
    createdAtIso: asIso(r.created_at),
  };
}
