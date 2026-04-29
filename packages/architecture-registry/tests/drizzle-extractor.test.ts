import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  extractSchemasFromInMemorySource,
  extractMigrationsFromMigrationsDir,
} from '../src';

const NOW = 1745812800000;
let counter = 0;
const idFactory = (prefix: string) => `${prefix}_${counter++}`;
const reset = () => { counter = 0; };

const baseOpts = () => ({
  repoRoot: '/repo',
  defaultProject: 'caia' as const,
  now: NOW,
  newId: idFactory,
});

const SAMPLE_SCHEMA = `
import { sqliteTable, text, integer, real, index, primaryKey } from 'drizzle-orm/sqlite-core';

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  email: text('email').notNull().unique(),
  age: integer('age'),
  createdAt: integer('created_at').notNull().default(0),
}, (t) => [
  index('users_email_idx').on(t.email),
]);

export const sessions = sqliteTable('sessions', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  token: text('token').notNull(),
});
`;

describe('extractSchemasFromInMemorySource', () => {
  beforeEach(() => reset());

  it('extracts table names + column metadata', () => {
    const r = extractSchemasFromInMemorySource(
      { path: '/repo/db/schema.ts', content: SAMPLE_SCHEMA },
      baseOpts(),
    );
    expect(r.warnings).toEqual([]);
    expect(r.artifacts.length).toBe(2);
    const names = r.artifacts.map((a) => a.name).sort();
    expect(names).toEqual(['sessions', 'users']);
  });

  it('captures columns + nullable + primary key + unique + defaults', () => {
    const r = extractSchemasFromInMemorySource(
      { path: '/repo/db/schema.ts', content: SAMPLE_SCHEMA },
      baseOpts(),
    );
    const users = r.artifacts.find((a) => a.name === 'users')!;
    const meta = JSON.parse(users.metadataJson);
    expect(meta.columns).toHaveLength(4);
    const id = meta.columns.find((c: { name: string }) => c.name === 'id');
    expect(id.isPrimaryKey).toBe(true);
    expect(id.nullable).toBe(false);
    const email = meta.columns.find((c: { name: string }) => c.name === 'email');
    expect(email.isUnique).toBe(true);
    expect(email.nullable).toBe(false);
    const age = meta.columns.find((c: { name: string }) => c.name === 'age');
    expect(age.nullable).toBe(true);
    expect(age.isPrimaryKey).toBe(false);
    const createdAt = meta.columns.find((c: { name: string }) => c.name === 'createdAt');
    expect(createdAt.defaultValue).toBe('0');
    expect(createdAt.type).toBe('integer');
  });

  it('captures table indexes', () => {
    const r = extractSchemasFromInMemorySource(
      { path: '/repo/db/schema.ts', content: SAMPLE_SCHEMA },
      baseOpts(),
    );
    const users = r.artifacts.find((a) => a.name === 'users')!;
    const meta = JSON.parse(users.metadataJson);
    expect(meta.indexes).toHaveLength(1);
    expect(meta.indexes[0].name).toBe('users_email_idx');
    expect(meta.indexes[0].columns).toEqual(['email']);
  });

  it('produces stable dedup keys on re-extraction', () => {
    const r1 = extractSchemasFromInMemorySource(
      { path: '/repo/db/schema.ts', content: SAMPLE_SCHEMA },
      baseOpts(),
    );
    counter = 0;
    const r2 = extractSchemasFromInMemorySource(
      { path: '/repo/db/schema.ts', content: SAMPLE_SCHEMA },
      baseOpts(),
    );
    const k1 = r1.artifacts.map((a) => a.dedupKey).sort();
    const k2 = r2.artifacts.map((a) => a.dedupKey).sort();
    expect(k1).toEqual(k2);
  });

  it('skips non-drizzle exports gracefully', () => {
    const r = extractSchemasFromInMemorySource(
      {
        path: '/repo/db/schema.ts',
        content: `
import { sqliteTable, text } from 'drizzle-orm/sqlite-core';
export const users = sqliteTable('users', { id: text('id').primaryKey() });
export const helper = () => 42;
export const config = { foo: 'bar' };
`,
      },
      baseOpts(),
    );
    expect(r.artifacts).toHaveLength(1);
    expect(r.artifacts[0]!.name).toBe('users');
  });

  it('tags every schema row as database', () => {
    const r = extractSchemasFromInMemorySource(
      { path: '/repo/db/schema.ts', content: SAMPLE_SCHEMA },
      baseOpts(),
    );
    for (const a of r.artifacts) {
      expect(a.techSubDomains).toContain('database');
      expect(a.kind).toBe('schema');
    }
  });
});

describe('extractMigrationsFromMigrationsDir', () => {
  let root: string;
  let migDir: string;

  beforeEach(() => {
    counter = 0;
    root = mkdtempSync(join(tmpdir(), 'akg-mig-'));
    migDir = join(root, 'migrations');
    mkdirSync(join(migDir, 'meta'), { recursive: true });
    writeFileSync(
      join(migDir, '0001_initial.sql'),
      `CREATE TABLE users (id TEXT PRIMARY KEY);\nCREATE INDEX users_idx ON users (id);`,
    );
    writeFileSync(
      join(migDir, '0002_add_sessions.sql'),
      `CREATE TABLE sessions (id TEXT, user_id TEXT);\nALTER TABLE users ADD COLUMN email TEXT;`,
    );
    writeFileSync(
      join(migDir, '0003_pending.sql'),
      `CREATE TABLE pending (id TEXT);`,
    );
    writeFileSync(
      join(migDir, 'meta/_journal.json'),
      JSON.stringify({
        entries: [
          { idx: 0, tag: '0001_initial', when: 0 },
          { idx: 1, tag: '0002_add_sessions', when: 0 },
        ],
      }),
    );
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it('extracts every *.sql migration', () => {
    const r = extractMigrationsFromMigrationsDir(migDir, {
      ...baseOpts(),
      repoRoot: root,
    });
    expect(r.warnings).toEqual([]);
    expect(r.artifacts.length).toBe(3);
    const names = r.artifacts.map((a) => a.name).sort();
    expect(names).toEqual(['0001_initial.sql', '0002_add_sessions.sql', '0003_pending.sql']);
  });

  it('parses sequence number + checksum + affected tables', () => {
    const r = extractMigrationsFromMigrationsDir(migDir, {
      ...baseOpts(),
      repoRoot: root,
    });
    const second = r.artifacts.find((a) => a.name === '0002_add_sessions.sql')!;
    const meta = JSON.parse(second.metadataJson);
    expect(meta.sequenceNumber).toBe(2);
    expect(meta.checksum).toMatch(/^[0-9a-f]{64}$/);
    expect(meta.affectsTables).toContain('sessions');
    expect(meta.affectsTables).toContain('users');
  });

  it('marks migrations applied/pending via _journal.json', () => {
    const r = extractMigrationsFromMigrationsDir(migDir, {
      ...baseOpts(),
      repoRoot: root,
    });
    const first = r.artifacts.find((a) => a.name === '0001_initial.sql')!;
    const third = r.artifacts.find((a) => a.name === '0003_pending.sql')!;
    expect(JSON.parse(first.metadataJson).isApplied).toBe(true);
    expect(JSON.parse(third.metadataJson).isApplied).toBe(false);
    expect(first.tags).toContain('applied');
    expect(third.tags).toContain('pending');
  });

  it('returns a warning when the migrations dir does not exist', () => {
    const r = extractMigrationsFromMigrationsDir('/no/such/dir', baseOpts());
    expect(r.artifacts).toHaveLength(0);
    expect(r.warnings.length).toBe(1);
  });

  it('produces stable dedup keys on re-extraction', () => {
    const r1 = extractMigrationsFromMigrationsDir(migDir, { ...baseOpts(), repoRoot: root });
    counter = 0;
    const r2 = extractMigrationsFromMigrationsDir(migDir, { ...baseOpts(), repoRoot: root });
    expect(r1.artifacts.map((a) => a.dedupKey).sort()).toEqual(
      r2.artifacts.map((a) => a.dedupKey).sort(),
    );
  });

  it('tags every migration as database + data-migration', () => {
    const r = extractMigrationsFromMigrationsDir(migDir, { ...baseOpts(), repoRoot: root });
    for (const a of r.artifacts) {
      expect(a.techSubDomains).toContain('database');
      expect(a.techSubDomains).toContain('data-migration');
    }
  });
});
