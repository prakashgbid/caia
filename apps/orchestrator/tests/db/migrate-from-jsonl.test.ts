import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from '../../src/db/schema';
import { requirements, tasks, blockers, questions, projects } from '../../src/db/schema';
import { migrateFromJsonl } from '../../src/db/migrate-from-jsonl';
import { seedProjects } from '../../src/db/seed-projects';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function makeTmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'conductor-migrate-test-'));
}

describe('migrateFromJsonl', () => {
  it('returns migrated=0 when no snapshot files exist', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();

    try {
      const result = await migrateFromJsonl(db, tmpDir);
      expect(result.migrated).toBe(0);
      expect(result.skipped).toBe(0);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('migrates requirements from snapshot', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();
    await seedProjects(db);

    const snapshot = {
      requirements: {
        'req_test1': {
          title: 'Test requirement',
          description: 'A poker-zeno feature',
          state: 'captured',
          priority: 3,
          labels: ['test'],
          targetProject: '~/Documents/projects/poker-zeno',
          estimatedFiles: [],
          dependsOn: [],
          linkedTaskIds: [],
          capturedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      lastEventId: 'evt_1',
    };
    fs.writeFileSync(path.join(tmpDir, 'requirements.snapshot.json'), JSON.stringify(snapshot));

    const result = await migrateFromJsonl(db, tmpDir);
    expect(result.migrated).toBe(1);

    const rows = db.select().from(requirements).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Test requirement');
    expect(rows[0]!.id).toBe('req_test1');

    // Should infer pokerzeno project
    const allProjects = db.select().from(projects).all();
    const pokerzeno = allProjects.find(p => p.slug === 'pokerzeno');
    expect(pokerzeno).toBeDefined();
    expect(rows[0]!.projectId).toBe(pokerzeno?.id);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('is idempotent - does not duplicate on second run', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();
    await seedProjects(db);

    const snapshot = {
      requirements: {
        'req_x': {
          title: 'X',
          description: '',
          state: 'captured',
          priority: 3,
          labels: [],
          estimatedFiles: [],
          dependsOn: [],
          linkedTaskIds: [],
          capturedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      lastEventId: '',
    };
    fs.writeFileSync(path.join(tmpDir, 'requirements.snapshot.json'), JSON.stringify(snapshot));

    const r1 = await migrateFromJsonl(db, tmpDir);
    const r2 = await migrateFromJsonl(db, tmpDir);

    expect(r1.migrated).toBe(1);
    expect(r2.migrated).toBe(0);
    expect(r2.skipped).toBe(1);

    const rows = db.select().from(requirements).all();
    expect(rows).toHaveLength(1);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates blockers from snapshot', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();
    await seedProjects(db);

    const snapshot = {
      blockers: {
        'blk_001': {
          title: 'Need env vars',
          severity: 'high',
          kind: 'credentials',
          description: 'Missing vars',
          resolutionSteps: [],
          links: [],
          state: 'open',
          createdAt: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'blockers.snapshot.json'), JSON.stringify(snapshot));

    const result = await migrateFromJsonl(db, tmpDir);
    expect(result.migrated).toBe(1);

    const rows = db.select().from(blockers).all();
    expect(rows[0]!.id).toBe('blk_001');
    expect(rows[0]!.state).toBe('open');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates questions from snapshot', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();
    await seedProjects(db);

    const snapshot = {
      questions: {
        'q_001': {
          title: 'Which DB?',
          priority: 'urgent',
          context: 'Need to pick a DB',
          recommendations: [{ id: 'rec_a', label: 'SQLite', rationale: 'Simple' }],
          state: 'open',
          createdAt: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'questions.snapshot.json'), JSON.stringify(snapshot));

    const result = await migrateFromJsonl(db, tmpDir);
    expect(result.migrated).toBe(1);

    const rows = db.select().from(questions).all();
    expect(rows[0]!.id).toBe('q_001');
    expect(rows[0]!.priority).toBe('urgent');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates tasks from state snapshot', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();
    await seedProjects(db);

    const snapshot = {
      tasks: {
        'tsk_001': {
          title: 'Build feature',
          sessionId: 'sess_1',
          status: 'completed',
          cwd: '/projects/pokerzeno',
          declaredFiles: ['pokerzeno/src/feature.ts'],
          dependsOn: [],
          spawnedBy: 'user',
          bypassUsed: false,
          createdAt: new Date().toISOString(),
          completedAt: new Date().toISOString(),
        },
      },
    };
    fs.writeFileSync(path.join(tmpDir, 'state.snapshot.json'), JSON.stringify(snapshot));

    const result = await migrateFromJsonl(db, tmpDir);
    expect(result.migrated).toBe(1);

    const rows = db.select().from(tasks).all();
    expect(rows[0]!.id).toBe('tsk_001');
    expect(rows[0]!.status).toBe('completed');

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('infers projectId from keyword in title', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();
    await seedProjects(db);

    const snapshot = {
      requirements: {
        'req_kw': {
          title: 'Add analytics dashboard feature',
          description: '',
          state: 'captured',
          priority: 3,
          labels: [],
          estimatedFiles: [],
          dependsOn: [],
          linkedTaskIds: [],
          capturedAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      },
      lastEventId: '',
    };
    fs.writeFileSync(path.join(tmpDir, 'requirements.snapshot.json'), JSON.stringify(snapshot));

    await migrateFromJsonl(db, tmpDir);
    const rows = db.select().from(requirements).all();

    const allProjects = db.select().from(projects).all();
    const analytics = allProjects.find(p => p.slug === 'analytics');
    expect(analytics).toBeDefined();
    expect(rows[0]!.projectId).toBe(analytics?.id);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('handles malformed snapshot JSON gracefully', async () => {
    const tmpDir = makeTmpDir();
    const db = createTestDb();

    fs.writeFileSync(path.join(tmpDir, 'requirements.snapshot.json'), '{ invalid json ]]');

    const result = await migrateFromJsonl(db, tmpDir);
    expect(result.migrated).toBe(0);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
