import { eq, and } from 'drizzle-orm';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { nanoid } = require('nanoid') as { nanoid: (size?: number) => string };

import type { Db } from '../db/connection';
import { redisCacheOptions } from '../db/schema';

export interface RedisCacheOptionsRecord {
  id: string;
  name: string;
  projectId: string | null;
  host: string;
  port: number;
  dbIndex: number;
  password: string | null;
  keyPrefix: string;
  ttlSeconds: number;
  maxEntries: number | null;
  enabled: boolean;
  status: string;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

export interface InsertRedisCacheOptionsInput {
  name: string;
  projectId?: string;
  host?: string;
  port?: number;
  dbIndex?: number;
  password?: string;
  keyPrefix?: string;
  ttlSeconds?: number;
  maxEntries?: number;
  scope?: string;
}

export interface UpdateRedisCacheOptionsInput {
  name?: string;
  host?: string;
  port?: number;
  dbIndex?: number;
  password?: string | null;
  keyPrefix?: string;
  ttlSeconds?: number;
  maxEntries?: number | null;
  enabled?: boolean;
  status?: string;
  scope?: string;
}

function toRecord(row: typeof redisCacheOptions.$inferSelect): RedisCacheOptionsRecord {
  return {
    id: row.id,
    name: row.name,
    projectId: row.projectId ?? null,
    host: row.host,
    port: row.port,
    dbIndex: row.dbIndex,
    password: row.password ?? null,
    keyPrefix: row.keyPrefix,
    ttlSeconds: row.ttlSeconds,
    maxEntries: row.maxEntries ?? null,
    enabled: Boolean(row.enabled),
    status: row.status,
    scope: row.scope,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Constructs a redis:// URL from a stored options record.
 * Password and db index are included when present.
 */
export function buildRedisUrl(record: Pick<RedisCacheOptionsRecord, 'host' | 'port' | 'dbIndex' | 'password'>): string {
  const auth = record.password ? `:${record.password}@` : '';
  const db = record.dbIndex > 0 ? `/${record.dbIndex}` : '';
  return `redis://${auth}${record.host}:${record.port}${db}`;
}

export class RedisCacheOptionsStore {
  constructor(private readonly db: Db) {}

  insert(input: InsertRedisCacheOptionsInput): RedisCacheOptionsRecord {
    const id = 'rco_' + nanoid(10);
    const now = new Date().toISOString();
    const row = {
      id,
      name: input.name,
      projectId: input.projectId ?? null,
      host: input.host ?? 'localhost',
      port: input.port ?? 6379,
      dbIndex: input.dbIndex ?? 0,
      password: input.password ?? null,
      keyPrefix: input.keyPrefix ?? '',
      ttlSeconds: input.ttlSeconds ?? 3600,
      maxEntries: input.maxEntries ?? null,
      enabled: true,
      status: 'active',
      scope: input.scope ?? 'global',
      createdAt: now,
      updatedAt: now,
    };
    this.db.insert(redisCacheOptions).values(row).run();
    return toRecord(row as typeof redisCacheOptions.$inferSelect);
  }

  findById(id: string): RedisCacheOptionsRecord | null {
    const row = this.db
      .select()
      .from(redisCacheOptions)
      .where(eq(redisCacheOptions.id, id))
      .get();
    return row ? toRecord(row) : null;
  }

  findByProject(projectId: string): RedisCacheOptionsRecord[] {
    return this.db
      .select()
      .from(redisCacheOptions)
      .where(
        and(
          eq(redisCacheOptions.projectId, projectId),
          eq(redisCacheOptions.status, 'active'),
        )
      )
      .all()
      .map(toRecord);
  }

  listActive(scope?: string): RedisCacheOptionsRecord[] {
    const conditions = [
      eq(redisCacheOptions.enabled, true),
      eq(redisCacheOptions.status, 'active'),
    ];
    if (scope) {
      conditions.push(eq(redisCacheOptions.scope, scope));
    }
    return this.db
      .select()
      .from(redisCacheOptions)
      .where(and(...conditions))
      .all()
      .map(toRecord);
  }

  update(id: string, patch: UpdateRedisCacheOptionsInput): RedisCacheOptionsRecord | null {
    const now = new Date().toISOString();
    this.db
      .update(redisCacheOptions)
      .set({ ...patch, updatedAt: now })
      .where(eq(redisCacheOptions.id, id))
      .run();
    return this.findById(id);
  }

  disable(id: string): void {
    this.db
      .update(redisCacheOptions)
      .set({ enabled: false, updatedAt: new Date().toISOString() })
      .where(eq(redisCacheOptions.id, id))
      .run();
  }

  delete(id: string): void {
    this.db
      .update(redisCacheOptions)
      .set({ status: 'deleted', enabled: false, updatedAt: new Date().toISOString() })
      .where(eq(redisCacheOptions.id, id))
      .run();
  }
}

let _store: RedisCacheOptionsStore | null = null;

export function getRedisCacheOptionsStore(db: Db): RedisCacheOptionsStore {
  if (!_store) {
    _store = new RedisCacheOptionsStore(db);
  }
  return _store;
}

export function resetRedisCacheOptionsStore(): void {
  _store = null;
}
