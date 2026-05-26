/**
 * In-memory store for `interview_threads` rows.
 *
 * Mirrors `MemoryProposalPersistence` from
 * `@caia/business-proposal-generator` — the wizard's V1 path runs
 * against this in-memory shim instead of a live per-tenant Postgres
 * connection. Wave 2 swaps this for a `PgInterviewThreadStore` reading
 * the 0012 migration's `{{SCHEMA}}.interview_threads` table.
 *
 * The store is keyed by `tenant_id + project_id`. A second
 * `advanceConversation()` call against the same project reuses the
 * existing thread (idempotent across page reloads in V1).
 */

import {
  type PillarCoverageMap,
  emptyPillarCoverage,
  applyAnswer,
  aggregateScore,
  questionForTurn,
  totalScriptedTurns,
  type ScriptedQuestion,
} from './interview-stub';

export interface QaPair {
  /** 1-based turn number — `agent` for the question, `user` for the reply. */
  readonly turn: number;
  readonly role: 'agent' | 'user';
  readonly content: string;
  readonly questionId?: string;
  readonly askedAt: string;
  readonly answeredAt?: string;
}

export interface InterviewThreadRow {
  readonly threadId: string;
  readonly tenantId: string;
  readonly projectId: string;
  readonly qaPairs: ReadonlyArray<QaPair>;
  readonly pillarCoverage: PillarCoverageMap;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface AdvanceResult {
  readonly thread: InterviewThreadRow;
  /** The new question to show — null when the interview is COMPLETE. */
  readonly nextQuestion: ScriptedQuestion | null;
  readonly aggregateScore: number;
  readonly meetsThreshold: boolean;
  /** True when the scripted bank is exhausted (no more questions). */
  readonly exhausted: boolean;
}

export interface InterviewThreadStore {
  start(args: { tenantId: string; projectId: string; threadId: string }): Promise<AdvanceResult>;
  advance(args: { tenantId: string; projectId: string; userReply: string }): Promise<AdvanceResult>;
  markComplete(args: { tenantId: string; projectId: string }): Promise<InterviewThreadRow>;
  read(args: { tenantId: string; projectId: string }): Promise<InterviewThreadRow | null>;
  /** Test-only — drop all rows. */
  __reset(): void;
}

function key(tenantId: string, projectId: string): string {
  return `${tenantId}::${projectId}`;
}

function nowIso(): string {
  return new Date().toISOString();
}

export function createMemoryInterviewThreadStore(): InterviewThreadStore {
  const rows = new Map<string, InterviewThreadRow>();

  function persist(row: InterviewThreadRow): InterviewThreadRow {
    rows.set(key(row.tenantId, row.projectId), row);
    return row;
  }

  function summarize(row: InterviewThreadRow): AdvanceResult {
    const userTurns = row.qaPairs.filter((p) => p.role === 'user').length;
    const nextTurn = userTurns + 1;
    const total = totalScriptedTurns();
    const exhausted = nextTurn > total;
    const nextQuestion = exhausted ? null : questionForTurn(nextTurn);
    const score = aggregateScore(row.pillarCoverage);
    return {
      thread: row,
      nextQuestion,
      aggregateScore: score,
      meetsThreshold: score >= 82 || exhausted,
      exhausted,
    };
  }

  return {
    async start({ tenantId, projectId, threadId }) {
      const existing = rows.get(key(tenantId, projectId));
      if (existing) {
        return summarize(existing);
      }
      const first = questionForTurn(1);
      const startIso = nowIso();
      const initialPairs: QaPair[] = first
        ? [
            {
              turn: 1,
              role: 'agent',
              content: first.text,
              questionId: first.id,
              askedAt: startIso,
            },
          ]
        : [];
      const row: InterviewThreadRow = {
        threadId,
        tenantId,
        projectId,
        qaPairs: initialPairs,
        pillarCoverage: emptyPillarCoverage(),
        startedAt: startIso,
        updatedAt: startIso,
        completedAt: null,
      };
      return summarize(persist(row));
    },

    async advance({ tenantId, projectId, userReply }) {
      const existing = rows.get(key(tenantId, projectId));
      if (!existing) {
        throw new Error(`thread-not-started: ${tenantId}::${projectId}`);
      }
      if (existing.completedAt) {
        throw new Error(`thread-already-completed: ${tenantId}::${projectId}`);
      }
      const userTurns = existing.qaPairs.filter((p) => p.role === 'user').length;
      const currentTurn = userTurns + 1;
      const currentQuestion = questionForTurn(currentTurn);
      if (!currentQuestion) {
        throw new Error(`no-pending-question: ${tenantId}::${projectId}`);
      }
      const answerIso = nowIso();
      const updatedCoverage = applyAnswer(
        existing.pillarCoverage,
        currentQuestion.pillar,
        currentTurn,
        userReply.length,
      );
      const userPair: QaPair = {
        turn: currentTurn,
        role: 'user',
        content: userReply,
        questionId: currentQuestion.id,
        askedAt: existing.qaPairs[existing.qaPairs.length - 1]?.askedAt ?? answerIso,
        answeredAt: answerIso,
      };
      // Pick the next question (if any) and append it as an agent turn.
      const nextTurn = currentTurn + 1;
      const nextQuestion = questionForTurn(nextTurn);
      const newPairs: QaPair[] = [...existing.qaPairs, userPair];
      if (nextQuestion) {
        newPairs.push({
          turn: nextTurn,
          role: 'agent',
          content: nextQuestion.text,
          questionId: nextQuestion.id,
          askedAt: answerIso,
        });
      }
      const updated: InterviewThreadRow = {
        ...existing,
        qaPairs: newPairs,
        pillarCoverage: updatedCoverage,
        updatedAt: answerIso,
      };
      return summarize(persist(updated));
    },

    async markComplete({ tenantId, projectId }) {
      const existing = rows.get(key(tenantId, projectId));
      if (!existing) {
        throw new Error(`thread-not-started: ${tenantId}::${projectId}`);
      }
      if (existing.completedAt) {
        return existing;
      }
      const completedIso = nowIso();
      const updated: InterviewThreadRow = {
        ...existing,
        completedAt: completedIso,
        updatedAt: completedIso,
      };
      return persist(updated);
    },

    async read({ tenantId, projectId }) {
      return rows.get(key(tenantId, projectId)) ?? null;
    },

    __reset() {
      rows.clear();
    },
  };
}

/**
 * Singleton instance for the V1 wizard path. The proposal route uses the
 * same singleton pattern (the route module just calls `new
 * MemoryProposalPersistence({...})` on every invocation, but the
 * interview thread has cross-request state — multi-turn — so we keep
 * one shared in-memory store for the process lifetime).
 */
let singleton: InterviewThreadStore | null = null;

export function getInterviewThreadStore(): InterviewThreadStore {
  if (!singleton) singleton = createMemoryInterviewThreadStore();
  return singleton;
}

export function __resetInterviewThreadStore(): void {
  singleton = null;
}
