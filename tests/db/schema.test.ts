import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import {
  projects,
  adrs,
  businessFeatures,
  proactiveSuggestions,
  timelineEvents,
  auditLog,
  requirements,
  tasks,
  blockers,
  questions,
} from '../../src/db/schema';
import { eq, desc } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/sqlite-core';
import { nanoid } from 'nanoid';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db;
}

function now() { return new Date().toISOString(); }

describe('Projects table', () => {
  it('inserts and retrieves a project', () => {
    const db = createTestDb();
    db.insert(projects).values({
      id: 'proj_test1',
      name: 'Test Project',
      slug: 'test-proj',
      kind: 'site',
      status: 'active',
      createdAt: now(),
      updatedAt: now(),
    }).run();

    const rows = db.select().from(projects).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.slug).toBe('test-proj');
    expect(rows[0]!.name).toBe('Test Project');
  });

  it('enforces unique slug constraint', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(projects).values({
      id: 'proj_a', name: 'A', slug: 'same-slug', kind: 'site', status: 'active', createdAt: ts, updatedAt: ts,
    }).run();

    expect(() => {
      db.insert(projects).values({
        id: 'proj_b', name: 'B', slug: 'same-slug', kind: 'site', status: 'active', createdAt: ts, updatedAt: ts,
      }).run();
    }).toThrow();
  });

  it('allows soft-archived projects to persist', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(projects).values({
      id: 'proj_arch', name: 'Old', slug: 'old', kind: 'plugin', status: 'archived', createdAt: ts, updatedAt: ts,
    }).run();

    const rows = db.select().from(projects).all();
    expect(rows[0]!.status).toBe('archived');
  });

  it('supports all project kinds', () => {
    const db = createTestDb();
    const ts = now();
    const kinds = ['site', 'plugin', 'framework', 'internal'] as const;
    for (const [i, kind] of kinds.entries()) {
      db.insert(projects).values({
        id: `proj_${i}`, name: kind, slug: `slug-${i}`, kind, status: 'active', createdAt: ts, updatedAt: ts,
      }).run();
    }
    const rows = db.select().from(projects).all();
    expect(rows).toHaveLength(4);
  });
});

describe('ADRs table', () => {
  it('inserts and retrieves an ADR', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(adrs).values({
      id: 'adr_001',
      number: 1,
      title: 'Use SQLite',
      status: 'accepted',
      context: 'We need a local DB',
      decision: 'Use SQLite',
      consequences: 'Portable and fast',
      alternatives: '[]',
      scope: 'global',
      createdAt: ts,
      updatedAt: ts,
    }).run();

    const rows = db.select().from(adrs).all();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe('Use SQLite');
    expect(rows[0]!.status).toBe('accepted');
  });

  it('orders ADRs by number descending', () => {
    const db = createTestDb();
    const ts = now();
    for (let n = 1; n <= 5; n++) {
      db.insert(adrs).values({
        id: `adr_${n}`, number: n, title: `ADR ${n}`, status: 'proposed',
        context: '', decision: '', consequences: '', alternatives: '[]',
        scope: 'global', createdAt: ts, updatedAt: ts,
      }).run();
    }

    const rows = db.select().from(adrs).orderBy(desc(adrs.number)).all();
    expect(rows[0]!.number).toBe(5);
    expect(rows[rows.length - 1]!.number).toBe(1);
  });
});

describe('Business Features table', () => {
  it('inserts a feature with phase', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(businessFeatures).values({
      id: 'feat_01',
      title: 'User Auth',
      description: 'OAuth2 login',
      phase: '1',
      status: 'in-progress',
      linkedRequirements: '[]',
      scope: 'global',
      createdAt: ts,
      updatedAt: ts,
    }).run();

    const rows = db.select().from(businessFeatures).all();
    expect(rows[0]!.phase).toBe('1');
    expect(rows[0]!.status).toBe('in-progress');
  });
});

describe('Proactive Suggestions table', () => {
  it('inserts a pending suggestion', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(proactiveSuggestions).values({
      id: 'sug_01',
      title: 'Add caching',
      rationale: 'Performance benefit',
      options: '[{"id":"opt_a","label":"Redis"}]',
      state: 'pending',
      scope: 'global',
      createdAt: ts,
    }).run();

    const rows = db.select().from(proactiveSuggestions).all();
    expect(rows[0]!.state).toBe('pending');
  });

  it('updates suggestion to accepted', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(proactiveSuggestions).values({
      id: 'sug_02',
      title: 'Refactor service',
      rationale: 'Clean code',
      options: '[]',
      state: 'pending',
      scope: 'global',
      createdAt: ts,
    }).run();

    db.update(proactiveSuggestions).set({ state: 'accepted', acceptedOption: 'opt_a', resolvedAt: ts })
      .where(eq(proactiveSuggestions.id, 'sug_02')).run();

    const row = db.select().from(proactiveSuggestions).where(eq(proactiveSuggestions.id, 'sug_02')).all()[0];
    expect(row?.state).toBe('accepted');
  });
});

describe('Timeline Events table', () => {
  it('appends multiple events', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(timelineEvents).values({ id: 'tl_1', kind: 'requirement.created', subjectId: 'req_1', subjectKind: 'requirement', payload: '{}', createdAt: ts }).run();
    db.insert(timelineEvents).values({ id: 'tl_2', kind: 'task.completed', subjectId: 'tsk_1', subjectKind: 'task', payload: '{}', createdAt: ts }).run();

    const rows = db.select().from(timelineEvents).all();
    expect(rows).toHaveLength(2);
  });

  it('retrieves events ordered by createdAt desc', () => {
    const db = createTestDb();
    const t1 = '2024-01-01T10:00:00.000Z';
    const t2 = '2024-01-01T11:00:00.000Z';
    db.insert(timelineEvents).values({ id: 'tl_a', kind: 'ev.a', subjectId: 'x', subjectKind: 'task', payload: '{}', createdAt: t1 }).run();
    db.insert(timelineEvents).values({ id: 'tl_b', kind: 'ev.b', subjectId: 'x', subjectKind: 'task', payload: '{}', createdAt: t2 }).run();

    const rows = db.select().from(timelineEvents).orderBy(desc(timelineEvents.createdAt)).all();
    expect(rows[0]!.id).toBe('tl_b');
  });
});

describe('Audit Log table', () => {
  it('records an audit entry', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(auditLog).values({
      id: 'aud_01',
      actor: 'ai',
      action: 'create',
      entityKind: 'requirement',
      entityId: 'req_01',
      before: null,
      after: '{"title":"New req"}',
      createdAt: ts,
    }).run();

    const rows = db.select().from(auditLog).all();
    expect(rows[0]!.action).toBe('create');
    expect(rows[0]!.entityKind).toBe('requirement');
  });
});

describe('Requirements table', () => {
  it('inserts with JSON string fields', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(requirements).values({
      id: 'req_001',
      title: 'Build login page',
      description: 'OAuth2 login',
      state: 'captured',
      priority: 2,
      labels: '["auth","frontend"]',
      estimatedFiles: '["src/login.tsx"]',
      dependsOn: '[]',
      linkedTaskIds: '[]',
      scope: 'global',
      createdAt: ts,
      updatedAt: ts,
    }).run();

    const rows = db.select().from(requirements).all();
    expect(rows[0]!.priority).toBe(2);
    expect(rows[0]!.labels).toBe('["auth","frontend"]');
  });
});

describe('Tasks table', () => {
  it('inserts a task with boolean bypassUsed', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(tasks).values({
      id: 'tsk_001',
      title: 'Fix bug',
      status: 'queued',
      cwd: '/projects/app',
      declaredFiles: '["src/app.ts"]',
      dependsOn: '[]',
      spawnedBy: 'user',
      bypassUsed: false,
      scope: 'global',
      createdAt: ts,
    }).run();

    const rows = db.select().from(tasks).all();
    expect(rows[0]!.bypassUsed).toBe(false);
    expect(rows[0]!.status).toBe('queued');
  });
});

describe('Blockers table', () => {
  it('inserts a blocker and can resolve it', () => {
    const db = createTestDb();
    const ts = now();
    db.insert(blockers).values({
      id: 'blk_001',
      title: 'Need API key',
      severity: 'high',
      kind: 'credentials',
      description: 'Missing API key for service X',
      resolutionSteps: '[{"order":1,"instruction":"Get key from dashboard"}]',
      links: '[]',
      state: 'open',
      scope: 'global',
      createdAt: ts,
    }).run();

    db.update(blockers).set({ state: 'resolved', resolvedAt: ts, resolvedBy: 'user' }).where(eq(blockers.id, 'blk_001')).run();

    const row = db.select().from(blockers).where(eq(blockers.id, 'blk_001')).all()[0];
    expect(row?.state).toBe('resolved');
    expect(row?.resolvedBy).toBe('user');
  });
});

// @no-events — structural schema validation, not a domain operation
describe('Schema foreign key reference callbacks', () => {
  it('resolves all .references() lambdas for every table', () => {
    // Tables that declare .references() columns — calling fk.reference() invokes the
    // lazy arrow lambdas (e.g. () => projects.id) that drizzle stores for deferred resolution.
    const tablesWithFKs = [
      schema.requirements,
      schema.tasks,
      schema.blockers,
      schema.questions,
      schema.adrs,
      schema.businessFeatures,
      schema.proactiveSuggestions,
      schema.timelineEvents,
      schema.auditLog,
      schema.taskSubtasks,
      schema.behaviorTestRuns,
      schema.behaviorTestFailures,
      schema.taskRunEvents,
      schema.stories,
      schema.storyRevisions,
      schema.lockContractRevisions,
      schema.completenessFindings,
      schema.executorRuns,
      schema.taskAttempts,
      schema.buildSteps,
      schema.buildRetries,
      schema.promptResponses,
      schema.taskStatusTransitions,
    ];

    for (const table of tablesWithFKs) {
      const config = getTableConfig(table);
      for (const fk of config.foreignKeys) {
        expect(() => fk.reference()).not.toThrow();
        const ref = fk.reference();
        expect(ref.foreignTable).toBeDefined();
        expect(Array.isArray(ref.foreignColumns)).toBe(true);
        expect(ref.foreignColumns.length).toBeGreaterThan(0);
      }
    }
  });
});
