/**
 * @caia/interviewer — Postgres persistence layer.
 *
 * Per spec §6: every interview lives in a per-tenant schema
 * `caia_<short>` (e.g., `caia_pt`). The persistence layer holds a pg
 * connection pool and translates between TypeScript snapshots and SQL
 * rows.
 *
 * Operations:
 *   • ensureSchema(slug)            — apply 0001_interviewer.sql with
 *                                     {{SCHEMA}} substituted
 *   • createInterview(...)          — INSERT into interviews
 *   • appendTurn(...)               — INSERT into interview_turns
 *   • snapshotRevision(...)         — INSERT into business_plan_revisions
 *   • markDeferred(...)             — INSERT/UPDATE interview_deferred
 *   • updateState(...)              — UPDATE interviews.state + turn_number
 *   • forceClose(...)               — atomic state=FORCE_CLOSED + close_reason
 *   • resumeInterview(...)          — sets resumed_at, state=PLANNING
 *   • loadInterview(id)             — returns full row + latest revision
 *
 * Concurrency: state transitions are guarded with a row-level lock
 * (SELECT ... FOR UPDATE) to prevent concurrent writes from corrupting
 * turn_number sequencing.
 *
 * The pg `Pool` is supplied by the caller — we do NOT manage connection
 * lifecycles. This makes the layer trivially testable (use pg-mem in
 * tests) and avoids leaking pool ownership.
 */
import { readFile } from 'node:fs/promises';
import { dirname, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { InterviewerError } from './errors.js';
// ─────────────────────────────────────────────────────────────────────────
// Schema-name sanitization (defence-in-depth; only `caia_[a-z0-9_]{1,40}`
// is accepted to prevent SQL identifier injection).
// ─────────────────────────────────────────────────────────────────────────
const TENANT_SLUG_RE = /^[a-z][a-z0-9-]{0,39}$/;
const SCHEMA_NAME_RE = /^caia_[a-z0-9_]{1,40}$/;
export function tenantSchemaName(slug) {
    if (!TENANT_SLUG_RE.test(slug)) {
        throw new InterviewerError('persistence_failure', `invalid tenant slug ${slug}: must match [a-z0-9][a-z0-9-]{0,39}`, { slug });
    }
    const safe = slug.replace(/-/g, '_');
    const schema = `caia_${safe}`;
    if (!SCHEMA_NAME_RE.test(schema)) {
        throw new InterviewerError('persistence_failure', `derived schema ${schema} is invalid`, {
            slug,
            schema,
        });
    }
    return schema;
}
// ─────────────────────────────────────────────────────────────────────────
export class InterviewerPersistence {
    opts;
    constructor(opts) {
        this.opts = opts;
    }
    // ─────────────────────────────────────────────────────────────────────
    // Schema bootstrap
    // ─────────────────────────────────────────────────────────────────────
    async ensureSchema(slug) {
        const schema = tenantSchemaName(slug);
        const ddl = await this.loadMigration();
        const sql = ddl.replace(/\{\{SCHEMA\}\}/g, schema);
        await this.opts.pool.query(sql);
    }
    // ─────────────────────────────────────────────────────────────────────
    // Interview CRUD
    // ─────────────────────────────────────────────────────────────────────
    async createInterview(input) {
        const schema = tenantSchemaName(input.tenantSlug);
        const sql = `
      INSERT INTO ${schema}.interviews (
        id, tenant_slug, operator_email, grand_idea_prompt,
        state, responder_role, llm_call_budget, metadata
      ) VALUES ($1, $2, $3, $4, 'INIT', $5, $6, $7)
      RETURNING *
    `;
        const result = await this.opts.pool.query(sql, [
            input.id,
            input.tenantSlug,
            input.operatorEmail,
            input.grandIdeaPrompt,
            input.responderRole ?? 'founder',
            input.llmCallBudget ?? 150,
            JSON.stringify(input.metadata ?? {}),
        ]);
        return this.rowToInterview(result.rows[0]);
    }
    async appendTurn(input) {
        const schema = tenantSchemaName(input.tenantSlug);
        const sql = `
      INSERT INTO ${schema}.interview_turns (
        id, interview_id, turn_number, role, content,
        question_ids, pillars_covered, asked_at, answered_at, llm_call_count, metadata
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (interview_id, turn_number, role) DO NOTHING
    `;
        try {
            await this.opts.pool.query(sql, [
                input.id,
                input.interviewId,
                input.turnNumber,
                input.role,
                input.content,
                input.questionIds ? [...input.questionIds] : [],
                input.pillarsCovered ? [...input.pillarsCovered] : [],
                input.askedAt,
                input.answeredAt ?? null,
                input.llmCallCount ?? 0,
                JSON.stringify(input.metadata ?? {}),
            ]);
        }
        catch (e) {
            throw new InterviewerError('persistence_failure', `appendTurn failed: ${e.message}`, { interviewId: input.interviewId, turn: input.turnNumber });
        }
    }
    async snapshotRevision(input) {
        const schema = tenantSchemaName(input.tenantSlug);
        const sql = `
      INSERT INTO ${schema}.business_plan_revisions (
        interview_id, revision_number, at_turn_number, document, diff_from_prev,
        rubric_scores, satisfaction_score
      ) VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (interview_id, revision_number) DO NOTHING
    `;
        await this.opts.pool.query(sql, [
            input.interviewId,
            input.revisionNumber,
            input.atTurnNumber,
            JSON.stringify(input.document),
            input.diffFromPrev ? JSON.stringify(input.diffFromPrev) : null,
            JSON.stringify(input.rubricScores),
            input.satisfactionScore,
        ]);
    }
    async updateState(input) {
        const schema = tenantSchemaName(input.tenantSlug);
        const setClauses = ['state = $2'];
        const params = [input.interviewId, input.state];
        let p = 3;
        if (input.turnNumber !== undefined) {
            setClauses.push(`turn_number = $${p++}`);
            params.push(input.turnNumber);
        }
        if (input.llmCallCount !== undefined) {
            setClauses.push(`llm_call_count = $${p++}`);
            params.push(input.llmCallCount);
        }
        if (input.criticPassesRun !== undefined) {
            setClauses.push(`critic_passes_run = $${p++}`);
            params.push(input.criticPassesRun);
        }
        if (input.fatigueOverrides !== undefined) {
            setClauses.push(`fatigue_overrides = $${p++}`);
            params.push(input.fatigueOverrides);
        }
        if (input.rubricAggregateScore !== undefined) {
            setClauses.push(`rubric_aggregate_score = $${p++}`);
            params.push(input.rubricAggregateScore);
        }
        if (input.state === 'PAUSED') {
            setClauses.push(`paused_at = now()`);
        }
        else if (input.state === 'COMPLETE' || input.state === 'HANDOFF') {
            setClauses.push(`completed_at = COALESCE(completed_at, now())`);
        }
        const sql = `UPDATE ${schema}.interviews SET ${setClauses.join(', ')} WHERE id = $1`;
        await this.opts.pool.query(sql, params);
    }
    async forceClose(input) {
        const schema = tenantSchemaName(input.tenantSlug);
        const sql = `
      UPDATE ${schema}.interviews
      SET state = 'FORCE_CLOSED',
          close_reason = $2,
          closed_by = $3,
          completed_at = COALESCE(completed_at, now())
      WHERE id = $1 AND state NOT IN ('HANDOFF','FORCE_CLOSED')
    `;
        await this.opts.pool.query(sql, [input.interviewId, input.closeReason, input.closedBy]);
    }
    async resumeInterview(input) {
        const schema = tenantSchemaName(input.tenantSlug);
        const sql = `
      UPDATE ${schema}.interviews
      SET state = 'PLANNING',
          resumed_at = now()
      WHERE id = $1 AND state = 'PAUSED'
    `;
        await this.opts.pool.query(sql, [input.interviewId]);
    }
    async markDeferred(input) {
        const schema = tenantSchemaName(input.tenantSlug);
        const sql = `
      INSERT INTO ${schema}.interview_deferred (interview_id, question_id, asked_at_turn, reason, revisit_after_turn)
      VALUES ($1, $2, $3, $4, $5)
      ON CONFLICT (interview_id, question_id)
      DO UPDATE SET defer_count = ${schema}.interview_deferred.defer_count + 1
    `;
        await this.opts.pool.query(sql, [
            input.interviewId,
            input.questionId,
            input.askedAtTurn,
            input.reason,
            input.revisitAfterTurn ?? null,
        ]);
    }
    // ─────────────────────────────────────────────────────────────────────
    // Loads
    // ─────────────────────────────────────────────────────────────────────
    async loadInterview(slug, interviewId) {
        const schema = tenantSchemaName(slug);
        const client = await this.opts.pool.connect();
        try {
            const head = await client.query(`SELECT * FROM ${schema}.interviews WHERE id = $1`, [interviewId]);
            if (head.rows.length === 0) {
                throw new InterviewerError('unknown_interview', `no interview ${interviewId} in ${schema}`, {
                    interviewId,
                });
            }
            const interview = this.rowToInterview(head.rows[0]);
            const turnsR = await client.query(`SELECT * FROM ${schema}.interview_turns WHERE interview_id = $1 ORDER BY turn_number ASC, role ASC`, [interviewId]);
            const turns = turnsR.rows.map((r) => this.rowToTurn(r));
            const revR = await client.query(`SELECT * FROM ${schema}.business_plan_revisions WHERE interview_id = $1 ORDER BY revision_number DESC LIMIT 1`, [interviewId]);
            const latestRevision = revR.rows.length === 0
                ? null
                : {
                    interviewId,
                    tenantSlug: slug,
                    revisionNumber: revR.rows[0].revision_number,
                    atTurnNumber: revR.rows[0].at_turn_number,
                    document: revR.rows[0].document,
                    diffFromPrev: revR.rows[0].diff_from_prev ?? undefined,
                    rubricScores: revR.rows[0].rubric_scores,
                    satisfactionScore: Number(revR.rows[0].satisfaction_score ?? 0),
                };
            return { interview, turns, latestRevision };
        }
        finally {
            client.release();
        }
    }
    /**
     * Atomic state read+write — used to coordinate concurrent operators
     * (rare in practice, but cheap to enforce). The callback runs with a
     * SELECT ... FOR UPDATE lock held; the returned state value is what
     * persists (callback can also throw to abort).
     */
    async withInterviewLock(slug, interviewId, fn) {
        const schema = tenantSchemaName(slug);
        const client = await this.opts.pool.connect();
        try {
            await client.query('BEGIN');
            const head = await client.query(`SELECT * FROM ${schema}.interviews WHERE id = $1 FOR UPDATE`, [interviewId]);
            if (head.rows.length === 0) {
                await client.query('ROLLBACK');
                throw new InterviewerError('unknown_interview', `no interview ${interviewId} in ${schema}`, {
                    interviewId,
                });
            }
            const row = this.rowToInterview(head.rows[0]);
            const { next, result } = await fn(row, client);
            await client.query(`UPDATE ${schema}.interviews SET state = $2 WHERE id = $1`, [
                interviewId,
                next,
            ]);
            await client.query('COMMIT');
            return result;
        }
        catch (e) {
            try {
                await client.query('ROLLBACK');
            }
            catch {
                // already rolled back
            }
            throw e;
        }
        finally {
            client.release();
        }
    }
    // ─────────────────────────────────────────────────────────────────────
    // Row → object converters
    // ─────────────────────────────────────────────────────────────────────
    rowToInterview(row) {
        return {
            id: row['id'],
            tenantSlug: row['tenant_slug'],
            operatorEmail: row['operator_email'],
            grandIdeaPrompt: row['grand_idea_prompt'],
            state: row['state'],
            responderRole: row['responder_role'],
            turnNumber: row['turn_number'],
            llmCallCount: row['llm_call_count'],
            llmCallBudget: row['llm_call_budget'],
            criticPassesRun: row['critic_passes_run'],
            fatigueOverrides: row['fatigue_overrides'],
            businessPlanDocument: row['business_plan_document'],
            rubricAggregateScore: row['rubric_aggregate_score'] === null
                ? null
                : Number(row['rubric_aggregate_score']),
            closeReason: row['close_reason'] ?? null,
            closedBy: row['closed_by'] ?? null,
            startedAt: row['started_at'],
            pausedAt: row['paused_at'] ?? null,
            resumedAt: row['resumed_at'] ?? null,
            completedAt: row['completed_at'] ?? null,
            metadata: row['metadata'] ?? {},
        };
    }
    rowToTurn(row) {
        return {
            id: row['id'],
            interviewId: row['interview_id'],
            turnNumber: row['turn_number'],
            role: row['role'],
            content: row['content'],
            questionIds: row['question_ids'] ?? [],
            pillarsCovered: row['pillars_covered'] ?? [],
            askedAt: row['asked_at'],
            answeredAt: row['answered_at'] ?? null,
            llmCallCount: row['llm_call_count'],
            metadata: row['metadata'] ?? {},
        };
    }
    // ─────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────
    async loadMigration() {
        if (this.opts.migrationsPath) {
            return readFile(this.opts.migrationsPath, 'utf8');
        }
        const here = dirname(fileURLToPath(import.meta.url));
        const path = resolvePath(here, '..', 'migrations', '0001_interviewer.sql');
        return readFile(path, 'utf8');
    }
}
export class MemoryInterviewerPersistence {
    schemas = new Set();
    interviews = new Map();
    turns = new Map();
    revisions = new Map();
    deferred = new Map();
    async ensureSchema(slug) {
        this.schemas.add(tenantSchemaName(slug));
    }
    async createInterview(input) {
        if (this.interviews.has(input.id)) {
            throw new InterviewerError('persistence_failure', `interview ${input.id} already exists`, {
                id: input.id,
            });
        }
        const row = {
            id: input.id,
            tenantSlug: input.tenantSlug,
            operatorEmail: input.operatorEmail,
            grandIdeaPrompt: input.grandIdeaPrompt,
            state: 'INIT',
            responderRole: input.responderRole ?? 'founder',
            turnNumber: 0,
            llmCallCount: 0,
            llmCallBudget: input.llmCallBudget ?? 150,
            criticPassesRun: 0,
            fatigueOverrides: 0,
            businessPlanDocument: {},
            rubricAggregateScore: null,
            closeReason: null,
            closedBy: null,
            startedAt: new Date(),
            pausedAt: null,
            resumedAt: null,
            completedAt: null,
            metadata: { ...(input.metadata ?? {}) },
        };
        this.interviews.set(input.id, row);
        this.turns.set(input.id, []);
        this.revisions.set(input.id, []);
        this.deferred.set(input.id, new Map());
        return row;
    }
    async appendTurn(input) {
        const list = this.turns.get(input.interviewId);
        if (!list) {
            throw new InterviewerError('unknown_interview', `no interview ${input.interviewId}`, {
                interviewId: input.interviewId,
            });
        }
        if (list.some((t) => t.turnNumber === input.turnNumber && t.role === input.role)) {
            throw new InterviewerError('duplicate_turn', `turn ${input.turnNumber}/${input.role} already exists`, { interviewId: input.interviewId, turnNumber: input.turnNumber, role: input.role });
        }
        list.push({
            id: input.id,
            interviewId: input.interviewId,
            turnNumber: input.turnNumber,
            role: input.role,
            content: input.content,
            questionIds: input.questionIds ? [...input.questionIds] : [],
            pillarsCovered: input.pillarsCovered ? [...input.pillarsCovered] : [],
            askedAt: input.askedAt,
            answeredAt: input.answeredAt ?? null,
            llmCallCount: input.llmCallCount ?? 0,
            metadata: { ...(input.metadata ?? {}) },
        });
    }
    async snapshotRevision(input) {
        const list = this.revisions.get(input.interviewId);
        if (!list) {
            throw new InterviewerError('unknown_interview', `no interview ${input.interviewId}`, {
                interviewId: input.interviewId,
            });
        }
        if (list.some((r) => r.revisionNumber === input.revisionNumber))
            return; // idempotent
        list.push({ ...input });
        const row = this.interviews.get(input.interviewId);
        if (row) {
            row.businessPlanDocument = input.document;
            row.rubricAggregateScore =
                input.satisfactionScore;
        }
    }
    async updateState(input) {
        const row = this.interviews.get(input.interviewId);
        if (!row) {
            throw new InterviewerError('unknown_interview', `no interview ${input.interviewId}`, {
                interviewId: input.interviewId,
            });
        }
        const mutable = row;
        mutable.state = input.state;
        if (input.turnNumber !== undefined)
            mutable.turnNumber = input.turnNumber;
        if (input.llmCallCount !== undefined)
            mutable.llmCallCount = input.llmCallCount;
        if (input.criticPassesRun !== undefined)
            mutable.criticPassesRun = input.criticPassesRun;
        if (input.fatigueOverrides !== undefined)
            mutable.fatigueOverrides = input.fatigueOverrides;
        if (input.rubricAggregateScore !== undefined) {
            mutable.rubricAggregateScore = input.rubricAggregateScore;
        }
        if (input.state === 'PAUSED') {
            mutable.pausedAt = new Date();
        }
        if (input.state === 'COMPLETE' || input.state === 'HANDOFF') {
            mutable.completedAt = mutable.completedAt ?? new Date();
        }
    }
    async forceClose(input) {
        const row = this.interviews.get(input.interviewId);
        if (!row)
            return;
        if (row.state === 'HANDOFF' || row.state === 'FORCE_CLOSED')
            return;
        const mutable = row;
        mutable.state = 'FORCE_CLOSED';
        mutable.closeReason = input.closeReason;
        mutable.closedBy = input.closedBy;
        mutable.completedAt = new Date();
    }
    async resumeInterview(input) {
        const row = this.interviews.get(input.interviewId);
        if (!row)
            return;
        if (row.state !== 'PAUSED')
            return;
        const mutable = row;
        mutable.state = 'PLANNING';
        mutable.resumedAt = new Date();
    }
    async markDeferred(input) {
        const map = this.deferred.get(input.interviewId) ?? new Map();
        map.set(input.questionId, (map.get(input.questionId) ?? 0) + 1);
        this.deferred.set(input.interviewId, map);
    }
    async loadInterview(slug, interviewId) {
        void slug;
        const row = this.interviews.get(interviewId);
        if (!row) {
            throw new InterviewerError('unknown_interview', `no interview ${interviewId}`, {
                interviewId,
            });
        }
        const turns = [...(this.turns.get(interviewId) ?? [])];
        const revisions = [...(this.revisions.get(interviewId) ?? [])];
        const latestRevision = revisions.length === 0 ? null : revisions[revisions.length - 1];
        return { interview: row, turns, latestRevision };
    }
    // ─────────────────────────────────────────────────────────────────────
    // Test introspection helpers
    // ─────────────────────────────────────────────────────────────────────
    getDeferralCounts(interviewId) {
        const map = this.deferred.get(interviewId);
        if (!map)
            return {};
        return Object.fromEntries(map.entries());
    }
    getRevisions(interviewId) {
        return [...(this.revisions.get(interviewId) ?? [])];
    }
    getTurns(interviewId) {
        return [...(this.turns.get(interviewId) ?? [])];
    }
    allInterviews() {
        return [...this.interviews.values()];
    }
}
//# sourceMappingURL=persistence.js.map