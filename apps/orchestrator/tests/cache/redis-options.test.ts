/**
 * RedisCacheOptionsStore unit tests (12 cases).
 *
 *  1. insert returns record with generated rco_ id.
 *  2. insert persists to SQLite (findById returns the row).
 *  3. insert applies defaults (host=localhost, port=6379, ttlSeconds=3600).
 *  4. insert accepts all optional fields.
 *  5. findByProject returns only matching, active records.
 *  6. listActive returns only enabled+active rows.
 *  7. listActive filters by scope.
 *  8. update patches fields and bumps updatedAt.
 *  9. disable sets enabled=false, record remains findable.
 * 10. delete sets status=deleted and enabled=false (soft delete).
 * 11. buildRedisUrl — no auth, default db.
 * 12. buildRedisUrl — with password and non-zero dbIndex.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  RedisCacheOptionsStore,
  resetRedisCacheOptionsStore,
  buildRedisUrl,
} from '../../src/cache/redis-options';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.pragma('foreign_keys = OFF');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

describe('RedisCacheOptionsStore', () => {
  let store: RedisCacheOptionsStore;

  beforeEach(() => {
    resetRedisCacheOptionsStore();
    store = new RedisCacheOptionsStore(createTestDb());
  });

  it('1. insert returns record with generated rco_ id', () => {
    const r = store.insert({ name: 'default' });
    expect(r.id).toMatch(/^rco_/);
    expect(r.name).toBe('default');
    expect(r.createdAt).toBeTruthy();
  });

  it('2. insert persists to SQLite (findById returns the row)', () => {
    const r = store.insert({ name: 'persisted' });
    const found = store.findById(r.id);
    expect(found).not.toBeNull();
    expect(found!.name).toBe('persisted');
  });

  it('3. insert applies defaults (host, port, ttlSeconds)', () => {
    const r = store.insert({ name: 'defaults' });
    expect(r.host).toBe('localhost');
    expect(r.port).toBe(6379);
    expect(r.dbIndex).toBe(0);
    expect(r.ttlSeconds).toBe(3600);
    expect(r.keyPrefix).toBe('');
    expect(r.enabled).toBe(true);
    expect(r.status).toBe('active');
    expect(r.scope).toBe('global');
    expect(r.password).toBeNull();
    expect(r.maxEntries).toBeNull();
  });

  it('4. insert accepts all optional fields', () => {
    const r = store.insert({
      name: 'full',
      host: '10.0.0.1',
      port: 6380,
      dbIndex: 2,
      password: 'secret',
      keyPrefix: 'caia:',
      ttlSeconds: 900,
      maxEntries: 500,
      scope: 'project',
    });
    expect(r.host).toBe('10.0.0.1');
    expect(r.port).toBe(6380);
    expect(r.dbIndex).toBe(2);
    expect(r.password).toBe('secret');
    expect(r.keyPrefix).toBe('caia:');
    expect(r.ttlSeconds).toBe(900);
    expect(r.maxEntries).toBe(500);
    expect(r.scope).toBe('project');
  });

  it('5. findByProject returns only matching active records', () => {
    store.insert({ name: 'A', projectId: 'proj_1' });
    store.insert({ name: 'B', projectId: 'proj_1' });
    store.insert({ name: 'C', projectId: 'proj_2' });
    const rows = store.findByProject('proj_1');
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.projectId === 'proj_1')).toBe(true);
  });

  it('6. listActive returns only enabled+active rows', () => {
    const r1 = store.insert({ name: 'on' });
    const r2 = store.insert({ name: 'off' });
    store.disable(r2.id);
    const active = store.listActive();
    expect(active.some(r => r.id === r1.id)).toBe(true);
    expect(active.some(r => r.id === r2.id)).toBe(false);
  });

  it('7. listActive filters by scope', () => {
    store.insert({ name: 'global', scope: 'global' });
    store.insert({ name: 'project', scope: 'project' });
    const rows = store.listActive('project');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.scope).toBe('project');
  });

  it('8. update patches fields', () => {
    const r = store.insert({ name: 'old', ttlSeconds: 60 });
    const updated = store.update(r.id, { name: 'new', ttlSeconds: 120 });
    expect(updated).not.toBeNull();
    expect(updated!.name).toBe('new');
    expect(updated!.ttlSeconds).toBe(120);
    expect(updated!.updatedAt).toBeTruthy();
  });

  it('9. disable sets enabled=false, record remains findable', () => {
    const r = store.insert({ name: 'to-disable' });
    store.disable(r.id);
    const found = store.findById(r.id);
    expect(found).not.toBeNull();
    expect(found!.enabled).toBe(false);
    expect(found!.status).toBe('active');
  });

  it('10. delete sets status=deleted and enabled=false (soft delete)', () => {
    const r = store.insert({ name: 'to-delete' });
    store.delete(r.id);
    const found = store.findById(r.id);
    expect(found).not.toBeNull();
    expect(found!.status).toBe('deleted');
    expect(found!.enabled).toBe(false);
    const active = store.listActive();
    expect(active.some(x => x.id === r.id)).toBe(false);
  });
});

describe('buildRedisUrl', () => {
  it('11. no auth, default db produces redis://host:port', () => {
    const url = buildRedisUrl({ host: 'localhost', port: 6379, dbIndex: 0, password: null });
    expect(url).toBe('redis://localhost:6379');
  });

  it('12. with password and non-zero dbIndex includes both', () => {
    const url = buildRedisUrl({ host: '10.0.0.1', port: 6380, dbIndex: 3, password: 'secret' });
    expect(url).toBe('redis://:secret@10.0.0.1:6380/3');
  });
});
