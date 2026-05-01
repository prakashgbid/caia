// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import { eq, desc } from 'drizzle-orm';
import type { Db } from '../db/connection';
import { recommendations as recTable } from '../db/schema';
import type {
  Recommendation,
  CreateRecommendationParams,
  ListRecommendationsFilter,
  RecAlternative,
} from './types';

function toRow(rec: Recommendation): typeof recTable.$inferInsert {
  return {
    id: rec.id,
    title: rec.title,
    chosen: rec.chosen,
    rationale: rec.rationale,
    alternatives: JSON.stringify(rec.alternatives),
    context: rec.context,
    taskId: rec.taskId ?? undefined,
    requirementId: rec.requirementId ?? undefined,
    projectId: rec.projectId ?? undefined,
    scope: rec.scope,
    createdAt: rec.createdAt,
  };
}

function fromRow(row: typeof recTable.$inferSelect): Recommendation {
  return {
    id: row.id,
    title: row.title,
    chosen: row.chosen,
    rationale: row.rationale,
    alternatives: row.alternatives ? (JSON.parse(row.alternatives) as RecAlternative[]) : [],
    context: row.context ?? '',
    taskId: row.taskId,
    requirementId: row.requirementId,
    projectId: row.projectId,
    scope: row.scope,
    createdAt: row.createdAt,
  };
}

export class RecommendationsManager {
  constructor(private readonly db: Db) {}

  create(params: CreateRecommendationParams): Recommendation {
    const id = 'rcm_' + nanoid(8);
    const now = new Date().toISOString();
    const rec: Recommendation = {
      id,
      title: params.title,
      chosen: params.chosen,
      rationale: params.rationale,
      alternatives: params.alternatives ?? [],
      context: params.context ?? '',
      taskId: params.taskId ?? null,
      requirementId: params.requirementId ?? null,
      projectId: params.projectId ?? null,
      scope: params.scope ?? 'global',
      createdAt: now,
    };
    this.db.insert(recTable).values(toRow(rec)).run();
    return rec;
  }

  list(filter?: ListRecommendationsFilter): Recommendation[] {
    let rows = this.db
      .select()
      .from(recTable)
      .orderBy(desc(recTable.createdAt))
      .all();

    if (filter?.taskId) rows = rows.filter(r => r.taskId === filter.taskId);
    if (filter?.requirementId) rows = rows.filter(r => r.requirementId === filter.requirementId);
    if (filter?.projectId) rows = rows.filter(r => r.projectId === filter.projectId);
    if (filter?.scope) rows = rows.filter(r => r.scope === filter.scope);
    if (filter?.limit) rows = rows.slice(0, filter.limit);

    return rows.map(fromRow);
  }

  get(id: string): Recommendation | undefined {
    const row = this.db.select().from(recTable).where(eq(recTable.id, id)).all()[0];
    return row ? fromRow(row) : undefined;
  }
}
