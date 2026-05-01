import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { RecommendationsManager } from '../../src/recommendations/manager';
import type { CreateRecommendationParams } from '../../src/recommendations/types';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

const baseParams: CreateRecommendationParams = {
  title: 'Caching library selection',
  chosen: 'lru-cache',
  rationale: 'Simplest API, zero dependencies, fast LRU eviction',
  alternatives: [
    { name: 'node-cache', reason: 'No LRU eviction; excess memory growth under load' },
    { name: 'keyv', reason: 'Needs a separate storage adapter; over-engineered for in-process use' },
  ],
  context: 'Spike: compare lru-cache, node-cache, keyv, and redis-based options',
};

describe('RecommendationsManager', () => {
  let mgr: RecommendationsManager;

  beforeEach(() => {
    mgr = new RecommendationsManager(createTestDb());
  });

  it('create returns recommendation with rcm_ prefix id', () => {
    const rec = mgr.create(baseParams);
    expect(rec.id).toMatch(/^rcm_/);
  });

  it('create stores title, chosen, and rationale', () => {
    const rec = mgr.create(baseParams);
    expect(rec.title).toBe('Caching library selection');
    expect(rec.chosen).toBe('lru-cache');
    expect(rec.rationale).toBe('Simplest API, zero dependencies, fast LRU eviction');
  });

  it('create serialises alternatives array', () => {
    const rec = mgr.create(baseParams);
    expect(rec.alternatives).toHaveLength(2);
    expect(rec.alternatives[0]!.name).toBe('node-cache');
    expect(rec.alternatives[1]!.name).toBe('keyv');
  });

  it('create defaults alternatives to empty array when omitted', () => {
    const rec = mgr.create({ title: 'T', chosen: 'opt-A', rationale: 'reason' });
    expect(rec.alternatives).toEqual([]);
  });

  it('create defaults scope to global', () => {
    const rec = mgr.create(baseParams);
    expect(rec.scope).toBe('global');
  });

  it('create sets createdAt as ISO string', () => {
    const rec = mgr.create(baseParams);
    expect(new Date(rec.createdAt).getTime()).not.toBeNaN();
  });

  it('create stores optional taskId', () => {
    const rec = mgr.create({ ...baseParams, taskId: 'tsk_abc123' });
    expect(rec.taskId).toBe('tsk_abc123');
  });

  it('list returns all recommendations newest-first', () => {
    mgr.create({ ...baseParams, title: 'First' });
    mgr.create({ ...baseParams, title: 'Second' });
    const list = mgr.list();
    expect(list).toHaveLength(2);
    expect(list[0]!.title).toBe('Second');
  });

  it('list filters by taskId', () => {
    mgr.create({ ...baseParams, taskId: 'tsk_A' });
    mgr.create({ ...baseParams, taskId: 'tsk_B' });
    const result = mgr.list({ taskId: 'tsk_A' });
    expect(result).toHaveLength(1);
    expect(result[0]!.taskId).toBe('tsk_A');
  });

  it('list filters by requirementId', () => {
    mgr.create({ ...baseParams, requirementId: 'req_X' });
    mgr.create({ ...baseParams, requirementId: 'req_Y' });
    const result = mgr.list({ requirementId: 'req_X' });
    expect(result).toHaveLength(1);
    expect(result[0]!.requirementId).toBe('req_X');
  });

  it('list respects limit', () => {
    for (let i = 0; i < 5; i++) {
      mgr.create({ ...baseParams, title: `Rec ${i}` });
    }
    const result = mgr.list({ limit: 3 });
    expect(result).toHaveLength(3);
  });

  it('get returns the recommendation by id', () => {
    const rec = mgr.create(baseParams);
    const found = mgr.get(rec.id);
    expect(found).toBeDefined();
    expect(found!.id).toBe(rec.id);
    expect(found!.chosen).toBe('lru-cache');
  });

  it('get returns undefined for unknown id', () => {
    const result = mgr.get('rcm_unknown');
    expect(result).toBeUndefined();
  });

  it('each create generates a unique id', () => {
    const a = mgr.create(baseParams);
    const b = mgr.create(baseParams);
    expect(a.id).not.toBe(b.id);
  });
});
