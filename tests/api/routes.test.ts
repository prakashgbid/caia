import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { createApp } from '../../src/api/app';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as ReturnType<typeof drizzle<typeof schema>>;
}

async function req(
  app: ReturnType<typeof createApp>,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  const response = await app.request(`http://localhost${path}`, init);
  let responseBody: unknown;
  try {
    responseBody = await response.json();
  } catch {
    responseBody = null;
  }
  return { status: response.status, body: responseBody };
}

describe('GET /health', () => {
  it('returns ok', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/health');
    expect(status).toBe(200);
    expect((body as { ok: boolean }).ok).toBe(true);
    expect((body as { schema: string }).schema).toBe('v2');
  });
});

describe('Projects routes', () => {
  it('GET /projects returns empty array initially', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/projects');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
    expect((body as unknown[]).length).toBe(0);
  });

  it('POST /projects creates a project', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'POST', '/projects', {
      name: 'Test Site',
      slug: 'test-site',
      kind: 'site',
      color: '#FF0000',
    });
    expect(status).toBe(201);
    expect((body as { name: string }).name).toBe('Test Site');
    expect((body as { id: string }).id).toMatch(/^proj_/);
  });

  it('GET /projects/:id returns 404 for missing project', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'GET', '/projects/proj_nonexistent');
    expect(status).toBe(404);
  });

  it('GET /projects/:id returns project after creation', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body: created } = await req(app, 'POST', '/projects', {
      name: 'My Site',
      slug: 'my-site',
      kind: 'site',
    });
    const id = (created as { id: string }).id;
    const { status, body } = await req(app, 'GET', `/projects/${id}`);
    expect(status).toBe(200);
    expect((body as { name: string }).name).toBe('My Site');
  });

  it('filters projects by kind', async () => {
    const db = createTestDb();
    const app = createApp(db);
    await req(app, 'POST', '/projects', { name: 'Site A', slug: 'site-a', kind: 'site' });
    await req(app, 'POST', '/projects', { name: 'Plugin B', slug: 'plugin-b', kind: 'plugin' });

    const { body } = await req(app, 'GET', '/projects?kind=plugin');
    expect((body as unknown[]).length).toBe(1);
    expect(((body as { kind: string }[])[0]!).kind).toBe('plugin');
  });
});

describe('ADRs routes', () => {
  it('GET /adrs returns empty array initially', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/adrs');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('POST /adrs creates an ADR with auto-incremented number', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'POST', '/adrs', {
      title: 'Use SQLite',
      context: 'Need local DB',
      decision: 'Use SQLite with Drizzle',
    });
    expect(status).toBe(201);
    expect((body as { number: number }).number).toBe(1);
    expect((body as { id: string }).id).toMatch(/^adr_/);
  });

  it('ADR numbers auto-increment', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body: b1 } = await req(app, 'POST', '/adrs', { title: 'ADR 1', context: 'ctx', decision: 'dec' });
    const { body: b2 } = await req(app, 'POST', '/adrs', { title: 'ADR 2', context: 'ctx', decision: 'dec' });
    expect((b1 as { number: number }).number).toBe(1);
    expect((b2 as { number: number }).number).toBe(2);
  });

  it('GET /adrs/:id returns 404 for missing', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'GET', '/adrs/adr_nonexistent');
    expect(status).toBe(404);
  });
});

describe('Features routes', () => {
  it('POST /features creates a feature', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'POST', '/features', {
      title: 'User Dashboard',
      phase: '1',
      status: 'planned',
    });
    expect(status).toBe(201);
    expect((body as { title: string }).title).toBe('User Dashboard');
    expect((body as { phase: string }).phase).toBe('1');
  });

  it('filters features by phase', async () => {
    const db = createTestDb();
    const app = createApp(db);
    await req(app, 'POST', '/features', { title: 'Phase 1 feat', phase: '1' });
    await req(app, 'POST', '/features', { title: 'Icebox feat', phase: 'icebox' });

    const { body } = await req(app, 'GET', '/features?phase=icebox');
    expect((body as unknown[]).length).toBe(1);
  });
});

describe('Suggestions routes', () => {
  it('POST /suggestions creates a pending suggestion', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'POST', '/suggestions', {
      title: 'Add caching',
      rationale: 'Improves speed',
      options: [{ id: 'opt_a', label: 'Redis' }],
    });
    expect(status).toBe(201);
    expect((body as { state: string }).state).toBe('pending');
  });

  it('POST /suggestions/:id/accept changes state to accepted', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body: created } = await req(app, 'POST', '/suggestions', {
      title: 'Cache strategy',
      rationale: 'Performance',
    });
    const id = (created as { id: string }).id;

    const { body: accepted } = await req(app, 'POST', `/suggestions/${id}/accept`, { option: 'opt_a' });
    expect((accepted as { state: string }).state).toBe('accepted');
    expect((accepted as { acceptedOption: string }).acceptedOption).toBe('opt_a');
  });

  it('POST /suggestions/:id/custom changes state to custom', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body: created } = await req(app, 'POST', '/suggestions', {
      title: 'Approach?',
      rationale: 'Design decision',
    });
    const id = (created as { id: string }).id;

    const { body: custom } = await req(app, 'POST', `/suggestions/${id}/custom`, { answer: 'Use approach C' });
    expect((custom as { state: string }).state).toBe('custom');
    expect((custom as { customAnswer: string }).customAnswer).toBe('Use approach C');
  });
});

describe('Timeline routes', () => {
  it('POST /timeline appends an event', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'POST', '/timeline', {
      kind: 'requirement.created',
      subjectId: 'req_001',
      subjectKind: 'requirement',
    });
    expect(status).toBe(201);
    expect((body as { kind: string }).kind).toBe('requirement.created');
    expect((body as { id: string }).id).toMatch(/^tl_/);
  });

  it('GET /timeline returns events ordered by recency', async () => {
    const db = createTestDb();
    const app = createApp(db);
    await req(app, 'POST', '/timeline', { kind: 'ev.a', subjectId: 's1', subjectKind: 'task' });
    await req(app, 'POST', '/timeline', { kind: 'ev.b', subjectId: 's2', subjectKind: 'task' });

    const { body } = await req(app, 'GET', '/timeline');
    const events = body as { kind: string }[];
    expect(events.length).toBe(2);
    // Most recent first
    expect(events[0]!.kind).toBe('ev.b');
  });
});

describe('Audit routes', () => {
  it('GET /audit returns empty array initially', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/audit');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });
});

describe('Metrics routes', () => {
  it('GET /metrics returns metrics object', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/metrics');
    expect(status).toBe(200);
    expect(typeof (body as { integrationHealthPct: number }).integrationHealthPct).toBe('number');
    expect((body as { integrationHealthPct: number }).integrationHealthPct).toBe(100);
  });
});

describe('Legacy routes', () => {
  it('GET /requirements returns array', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/requirements');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /blockers returns array', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/blockers');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /questions returns array', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/questions');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /tasks returns array', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/tasks');
    expect(status).toBe(200);
    expect(Array.isArray(body)).toBe(true);
  });

  it('GET /counts returns openBlockers and openQuestions', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/counts');
    expect(status).toBe(200);
    expect(typeof (body as { openBlockers: number }).openBlockers).toBe('number');
    expect(typeof (body as { openQuestions: number }).openQuestions).toBe('number');
  });
});
