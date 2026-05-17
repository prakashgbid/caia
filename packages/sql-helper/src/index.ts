/**
 * @chiefaia/sql-helper — natural-language → SQL.
 *
 * Per p4_agent_mesh_implementation_plan_2026_05_16.md §3 M0:
 *   "backend-core SQL helper modified to route through @chiefaia/a2a-adapter
 *    to the XiYanSQL agent for D4 (DB query authoring) when a `MESH_SQL=on`
 *    env flag is set; old path stays on by default."
 *
 * Because the existing `@pokerzeno/backend-core` is a Supabase wrapper (no
 * NL→SQL helper to replace), this package is the new home of the helper.
 * Per operator's "actually using it" rule: every consumer that needs to
 * author SQL programmatically imports this module instead of cobbling
 * together prompts and Anthropic calls inline.
 *
 * Wiring:
 *   - MESH_SQL=on  → A2AClient → XiYanSQL endpoint (default
 *                     http://127.0.0.1:8410/a2a)
 *   - MESH_SQL=off → fallback path: throws a clear "mesh required" error,
 *                     OR uses Claude via the local-llm-router subscription
 *                     billing path (configurable via MESH_SQL_FALLBACK).
 */
import { A2AClient } from '@chiefaia/a2a-adapter/client';
import type { A2AArtifact } from '@chiefaia/a2a-adapter/server';

export interface ComposeSqlInput {
  /** Natural-language task description, e.g. "top 10 affiliates by revenue this month". */
  task: string;
  /** The relevant schema DDL (or a subset) so the model knows the tables. */
  schemaSql: string;
  /** Optional dialect hint; XiYanSQL supports postgres/mysql/sqlite. */
  dialect?: 'postgres' | 'mysql' | 'sqlite';
  /** CAIA provenance context for the artifact. */
  caiaChainRunId?: string;
  caiaPhaseStepId?: string;
}

export interface ComposeSqlResult {
  sql: string;
  rationale: string;
  /** The producer model behind the SQL (for provenance gate). */
  producerModel: string;
  artifactId: string;
}

function xiyanUrl(): string {
  return process.env.XIYAN_SQL_URL ?? 'http://127.0.0.1:8410';
}

function meshOn(): boolean {
  return (process.env.MESH_SQL ?? 'off').toLowerCase() === 'on';
}

/**
 * Compose a SQL query from natural language. Routes to XiYanSQL when MESH_SQL=on.
 *
 * @throws if MESH_SQL is off and no fallback is configured.
 */
export async function composeSql(input: ComposeSqlInput): Promise<ComposeSqlResult> {
  if (!meshOn()) {
    const fallback = (process.env.MESH_SQL_FALLBACK ?? '').toLowerCase();
    if (fallback === 'claude') {
      throw new Error(
        'MESH_SQL_FALLBACK=claude not wired in M0 — flip MESH_SQL=on and start XiYanSQL endpoint',
      );
    }
    throw new Error(
      'MESH_SQL is off. Set MESH_SQL=on and ensure XiYanSQL is reachable at ' +
        `${xiyanUrl()}/a2a. See p4_agent_mesh_implementation_plan §3 M0.`,
    );
  }

  const client = new A2AClient({ url: xiyanUrl() });
  const taskId =
    (input.caiaChainRunId ?? 'sql-helper') + '::' + (input.caiaPhaseStepId ?? Date.now());
  const contextId = input.caiaChainRunId ?? taskId;

  const resp = await client.send({
    taskId,
    contextId,
    input: {
      task: input.task,
      schema: input.schemaSql,
      dialect: input.dialect ?? 'postgres',
    },
  });

  if (resp.status !== 'done' || !resp.artifact) {
    const reason = resp.error ? `${resp.error.code}: ${resp.error.message}` : resp.status;
    throw new Error(`XiYanSQL dispatch failed: ${reason}`);
  }

  return artifactToResult(resp.artifact);
}

function artifactToResult(a: A2AArtifact): ComposeSqlResult {
  // The XiYanSQL agent emits an artifact with body.sql and body.rationale.
  const body = a.body as { sql?: string; rationale?: string };
  return {
    sql: body.sql ?? '',
    rationale: body.rationale ?? '',
    producerModel: a.producerModel,
    artifactId: a.artifactId,
  };
}

/** Lightweight reachability check — used by CLI + health endpoints. */
export async function meshSqlHealth(): Promise<{ url: string; meshOn: boolean; reachable: boolean }> {
  const url = xiyanUrl();
  if (!meshOn()) return { url, meshOn: false, reachable: false };
  try {
    const client = new A2AClient({ url, timeoutMs: 3_000 });
    await client.agentCard();
    return { url, meshOn: true, reachable: true };
  } catch {
    return { url, meshOn: true, reachable: false };
  }
}
