/**
 * FREG-004 — backfill script integration tests.
 *
 * Drives the two backfill modes against a temp DB + a tempdir
 * codebase fixture. Uses StubEmbeddingClient so CI doesn't need Ollama.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  bootstrapVectorTables,
  StubEmbeddingClient,
} from '@chiefaia/feature-registry';
import {
  backfillFromCodebase,
  backfillFromStories,
} from '../../scripts/backfill-feature-registry';
import { getDb, getSqliteRaw, resetDb, runMigrations } from '../../src/db/connection';
import { stories } from '../../src/db/schema';

const DIM = 768;

function tempDbUrl(): string {
  return path.join(os.tmpdir(), `freg-backfill-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`);
}

function nowIso() {
  return new Date().toISOString();
}

describe('backfillFromStories', () => {
  let url: string;

  beforeEach(() => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    bootstrapVectorTables(getSqliteRaw(), DIM);
  });

  afterEach(() => {
    try { fs.unlinkSync(url); } catch { /* */ }
    resetDb();
  });

  it('synthesizes registry rows for verified stories only', async () => {
    const db = getDb();
    db.insert(stories).values([
      { id: 's_v1', kind: 'story', title: 'verified A', description: 'desc A', status: 'verified', projectSlug: 'pokerzeno', createdAt: nowIso() },
      { id: 's_v2', kind: 'story', title: 'verified B', description: 'desc B', status: 'partial', projectSlug: 'caia', createdAt: nowIso() },
      { id: 's_p1', kind: 'story', title: 'pending C', description: 'desc C', status: 'pending', projectSlug: 'pokerzeno', createdAt: nowIso() },
      { id: 's_f1', kind: 'story', title: 'failed D', description: 'desc D', status: 'failed', projectSlug: 'pokerzeno', createdAt: nowIso() },
    ]).run();

    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const r = await backfillFromStories(db, stub, {});

    expect(r.processed).toBe(2);
    expect(r.upserted).toBe(2);

    const sqlite = getSqliteRaw();
    const rows = sqlite.prepare("SELECT id, source FROM feature_registry").all() as Array<{ id: string; source: string }>;
    expect(rows).toHaveLength(2);
    expect(rows.every(r => r.source === 'backfill_stories')).toBe(true);
  });

  it('is idempotent — re-running does not duplicate rows', async () => {
    const db = getDb();
    db.insert(stories).values({ id: 's_v1', kind: 'story', title: 'verified A', description: 'desc A', status: 'verified', projectSlug: 'pokerzeno', createdAt: nowIso() }).run();

    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    await backfillFromStories(db, stub);
    await backfillFromStories(db, stub);

    const sqlite = getSqliteRaw();
    const count = sqlite.prepare('SELECT COUNT(*) as c FROM feature_registry').get() as { c: number };
    expect(count.c).toBe(1);
  });

  it('respects opts.project filter', async () => {
    const db = getDb();
    db.insert(stories).values([
      { id: 's_pz', kind: 'story', title: 'pz feature', description: 'A', status: 'verified', projectSlug: 'pokerzeno', createdAt: nowIso() },
      { id: 's_rc', kind: 'story', title: 'rc feature', description: 'B', status: 'verified', projectSlug: 'roulettecommunity', createdAt: nowIso() },
    ]).run();

    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const r = await backfillFromStories(db, stub, { project: 'pokerzeno' });
    expect(r.processed).toBe(1);
    expect(r.upserted).toBe(1);
  });

  it('opts.dryRun does not write rows', async () => {
    const db = getDb();
    db.insert(stories).values({ id: 's_v1', kind: 'story', title: 'verified A', description: 'desc A', status: 'verified', projectSlug: 'pokerzeno', createdAt: nowIso() }).run();

    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const r = await backfillFromStories(db, stub, { dryRun: true });
    expect(r.upserted).toBe(1);

    const sqlite = getSqliteRaw();
    const count = sqlite.prepare('SELECT COUNT(*) as c FROM feature_registry').get() as { c: number };
    expect(count.c).toBe(0);
  });

  it('opts.limit caps processed rows', async () => {
    const db = getDb();
    db.insert(stories).values([
      { id: 's_v1', kind: 'story', title: 'verified A', description: 'A', status: 'verified', projectSlug: 'pokerzeno', createdAt: nowIso() },
      { id: 's_v2', kind: 'story', title: 'verified B', description: 'B', status: 'verified', projectSlug: 'pokerzeno', createdAt: nowIso() },
      { id: 's_v3', kind: 'story', title: 'verified C', description: 'C', status: 'verified', projectSlug: 'pokerzeno', createdAt: nowIso() },
    ]).run();

    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const r = await backfillFromStories(db, stub, { limit: 2 });
    expect(r.processed).toBe(2);
  });
});

describe('backfillFromCodebase', () => {
  let url: string;
  let root: string;

  beforeEach(() => {
    resetDb();
    url = tempDbUrl();
    runMigrations(url);
    bootstrapVectorTables(getSqliteRaw(), DIM);

    root = fs.mkdtempSync(path.join(os.tmpdir(), 'freg-codebase-'));
    fs.mkdirSync(path.join(root, 'apps', 'pokerzeno', 'app', 'leaderboard'), { recursive: true });
    fs.mkdirSync(path.join(root, 'apps', 'pokerzeno', 'app', 'profile'), { recursive: true });
    fs.mkdirSync(path.join(root, 'apps', 'orchestrator', 'src', 'agents'), { recursive: true });
    fs.mkdirSync(path.join(root, 'apps', 'orchestrator', 'src', 'db', 'migrations'), { recursive: true });

    fs.writeFileSync(path.join(root, 'apps', 'pokerzeno', 'app', 'leaderboard', 'page.tsx'), 'export default function LeaderboardPage() {}');
    fs.writeFileSync(path.join(root, 'apps', 'pokerzeno', 'app', 'profile', 'page.tsx'), 'export default function ProfilePage() {}');
    fs.writeFileSync(path.join(root, 'apps', 'orchestrator', 'src', 'agents', 'po-agent.ts'), 'export const poAgent = {};');
    fs.writeFileSync(path.join(root, 'apps', 'orchestrator', 'src', 'db', 'migrations', '0001_users.sql'), 'CREATE TABLE users (id TEXT PRIMARY KEY);');
  });

  afterEach(() => {
    try { fs.unlinkSync(url); } catch { /* */ }
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* */ }
    resetDb();
  });

  it('discovers + upserts route, agent, and table features', async () => {
    const db = getDb();
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const r = await backfillFromCodebase(db, stub, root);

    expect(r.processed).toBe(4);
    expect(r.upserted).toBe(4);

    const sqlite = getSqliteRaw();
    const rows = sqlite.prepare("SELECT name, source, route_path, agent_name, db_tables_json FROM feature_registry").all() as Array<{
      name: string; source: string; route_path: string | null; agent_name: string | null; db_tables_json: string;
    }>;
    expect(rows.every(r => r.source === 'backfill_codebase')).toBe(true);

    const routes = rows.filter(r => r.route_path !== null);
    expect(routes).toHaveLength(2);
    expect(routes.map(r => r.route_path).sort()).toEqual(['/leaderboard', '/profile']);

    const agents = rows.filter(r => r.agent_name !== null);
    expect(agents).toHaveLength(1);
    expect(agents[0]!.agent_name).toBe('po-agent');

    const dbRows = rows.filter(r => JSON.parse(r.db_tables_json).length > 0);
    expect(dbRows).toHaveLength(1);
    expect(JSON.parse(dbRows[0]!.db_tables_json)).toEqual(['users']);
  });

  it('is idempotent across re-runs', async () => {
    const db = getDb();
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    await backfillFromCodebase(db, stub, root);
    await backfillFromCodebase(db, stub, root);

    const sqlite = getSqliteRaw();
    const count = sqlite.prepare('SELECT COUNT(*) as c FROM feature_registry').get() as { c: number };
    expect(count.c).toBe(4);
  });

  it('opts.project filter scopes to a single project', async () => {
    const db = getDb();
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const r = await backfillFromCodebase(db, stub, root, { project: 'pokerzeno' });
    expect(r.processed).toBe(2);
  });

  it('non-existent root logs warn and returns empty report (no throw)', async () => {
    const db = getDb();
    const stub = new StubEmbeddingClient('nomic-embed-text', DIM);
    const r = await backfillFromCodebase(db, stub, '/path/does/not/exist/anywhere');
    expect(r.processed).toBe(0);
    expect(r.errors).toBe(0);
  });
});
