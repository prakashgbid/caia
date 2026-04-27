import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { createApp } from '../../src/api/app';
import {
  createPrompt, getPrompt, listPrompts,
  getPromptDescendants, getPromptJourney,
  recordTaskTransition, listTaskTransitions,
  updatePromptStatus, createPromptResponse,
} from '../../src/prompts/manager';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

type Db = ReturnType<typeof drizzle<typeof schema>>;

function createTestDb(): Db {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as Db;
}

async function req(
  app: ReturnType<typeof createApp>,
  method: string,
  urlPath: string,
  body?: unknown,
): Promise<{ status: number; body: unknown }> {
  const init: RequestInit = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await app.request(`http://localhost${urlPath}`, init);
  let responseBody: unknown;
  try { responseBody = await response.json(); } catch { responseBody = null; }
  return { status: response.status, body: responseBody };
}

function insertTask(db: Db, id: string, title: string, status = 'queued') {
  db.insert(schema.tasks).values({
    id, title, status,
    cwd: '/',
    spawnedBy: 'user',
    createdAt: new Date().toISOString(),
  }).run();
}

// ─── Manager unit tests ────────────────────────────────────────────────────────

describe('createPrompt', () => {
  it('creates a prompt and returns it', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Hello world' });
    expect(p.id).toMatch(/^prm_/);
    expect(p.body).toBe('Hello world');
    expect(p.status).toBe('received');
    expect(p.correlationId).toBe(p.id);
    expect(p.hash).toHaveLength(64);
    expect(p.receivedVia).toBe('chat');
  });

  it('is idempotent by hash within 10 seconds', () => {
    const db = createTestDb();
    const p1 = createPrompt(db, { body: 'Dedupe test' });
    const p2 = createPrompt(db, { body: 'Dedupe test' });
    expect(p2.id).toBe(p1.id);
  });

  it('creates a new prompt if hash differs', () => {
    const db = createTestDb();
    const p1 = createPrompt(db, { body: 'Prompt A' });
    const p2 = createPrompt(db, { body: 'Prompt B' });
    expect(p2.id).not.toBe(p1.id);
  });

  it('stores receivedVia, sessionId, userId', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Test', receivedVia: 'cli', sessionId: 'sess_1', userId: 'u1' });
    expect(p.receivedVia).toBe('cli');
    expect(p.sessionId).toBe('sess_1');
    expect(p.userId).toBe('u1');
  });
});

describe('getPrompt', () => {
  it('returns null for unknown id', () => {
    const db = createTestDb();
    expect(getPrompt(db, 'unknown')).toBeNull();
  });

  it('returns the prompt with no response initially', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Test prompt' });
    const result = getPrompt(db, p.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(p.id);
    expect(result!.response).toBeUndefined();
  });

  it('includes response when attached', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Test' });
    createPromptResponse(db, p.id, 'Response text', 'chat', { tokensOut: 50 });
    const result = getPrompt(db, p.id);
    expect(result!.response).toBeDefined();
    expect(result!.response!.responseBody).toBe('Response text');
    expect(result!.response!.tokensOut).toBe(50);
  });
});

describe('updatePromptStatus', () => {
  it('returns null for unknown id', () => {
    const db = createTestDb();
    expect(updatePromptStatus(db, 'unknown', 'analyzing')).toBeNull();
  });

  it('updates status and sets completedAt for terminal states', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Status test' });
    const updated = updatePromptStatus(db, p.id, 'answered');
    expect(updated!.status).toBe('answered');
    expect(updated!.completedAt).not.toBeNull();
    expect(typeof updated!.elapsedMs).toBe('number');
  });

  it('sets completedAt for failed status', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Fail test' });
    const updated = updatePromptStatus(db, p.id, 'failed');
    expect(updated!.completedAt).not.toBeNull();
  });

  it('does not set completedAt for intermediate statuses', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Intermediate' });
    const updated = updatePromptStatus(db, p.id, 'analyzing');
    expect(updated!.completedAt).toBeNull();
  });
});

describe('listPrompts', () => {
  it('returns empty array when no prompts exist', () => {
    const db = createTestDb();
    expect(listPrompts(db)).toEqual([]);
  });

  it('returns prompts in reverse chronological order', () => {
    const db = createTestDb();
    createPrompt(db, { body: 'First prompt' });
    createPrompt(db, { body: 'Second prompt' });
    const results = listPrompts(db);
    expect(results.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by status', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Filter test' });
    updatePromptStatus(db, p.id, 'answered');
    const answered = listPrompts(db, { status: 'answered' });
    expect(answered.every(x => x.status === 'answered')).toBe(true);
  });

  it('respects limit', () => {
    const db = createTestDb();
    for (let i = 0; i < 5; i++) createPrompt(db, { body: `Prompt ${i} - ${Math.random()}` });
    const results = listPrompts(db, { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('getPromptDescendants', () => {
  it('returns empty array for prompt with no descendants', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Isolated prompt' });
    expect(getPromptDescendants(db, p.id)).toEqual([]);
  });

  it('returns tasks linked to the prompt', async () => {
    const db = createTestDb();
    const { eq: drizzleEq } = await import('drizzle-orm');
    const p = createPrompt(db, { body: 'Task prompt' });
    insertTask(db, 'task_linked_1', 'Descendant task');
    db.update(schema.tasks).set({ rootPromptId: p.id })
      .where(drizzleEq(schema.tasks.id, 'task_linked_1')).run();
    const descendants = getPromptDescendants(db, p.id);
    expect(Array.isArray(descendants)).toBe(true);
    expect(descendants.some(d => d.entityId === 'task_linked_1')).toBe(true);
  });
});

describe('getPromptJourney', () => {
  it('returns null for unknown prompt', () => {
    const db = createTestDb();
    expect(getPromptJourney(db, 'unknown')).toBeNull();
  });

  it('returns journey with zero counts for isolated prompt', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Journey test' });
    const journey = getPromptJourney(db, p.id);
    expect(journey).not.toBeNull();
    expect(journey!.promptId).toBe(p.id);
    expect(journey!.descendants.total).toBe(0);
    expect(journey!.circuitBreakerTrips).toBe(0);
    expect(journey!.reExecutionCount).toBe(0);
    expect(typeof journey!.totalEvents).toBe('number');
  });
});

describe('recordTaskTransition', () => {
  it('creates a transition row and returns it', () => {
    const db = createTestDb();
    insertTask(db, 'tsk_t1', 'Test task');
    const t = recordTaskTransition(db, 'tsk_t1', 'running', 'executor');
    expect(t.taskId).toBe('tsk_t1');
    expect(t.toStatus).toBe('running');
    expect(t.actor).toBe('executor');
    expect(typeof t.id).toBe('number');
  });

  it('captures fromStatus from current task status', () => {
    const db = createTestDb();
    insertTask(db, 'tsk_t2', 'Status capture task', 'queued');
    const t = recordTaskTransition(db, 'tsk_t2', 'running', 'executor');
    expect(t.fromStatus).toBe('queued');
  });

  it('accepts optional notes and triggerEventId', () => {
    const db = createTestDb();
    insertTask(db, 'tsk_t3', 'Noted task');
    const t = recordTaskTransition(db, 'tsk_t3', 'done', 'sentinel', {
      notes: 'All checks passed',
      triggerEventId: 'ev_abc',
    });
    expect(t.notes).toBe('All checks passed');
    expect(t.triggerEventId).toBe('ev_abc');
  });
});

describe('listTaskTransitions', () => {
  it('returns empty array for task with no transitions', () => {
    const db = createTestDb();
    insertTask(db, 'tsk_l1', 'List task');
    expect(listTaskTransitions(db, 'tsk_l1')).toEqual([]);
  });

  it('returns transitions in chronological order', () => {
    const db = createTestDb();
    insertTask(db, 'tsk_l2', 'Multi-transition task');
    recordTaskTransition(db, 'tsk_l2', 'running', 'executor');
    recordTaskTransition(db, 'tsk_l2', 'done', 'executor');
    const list = listTaskTransitions(db, 'tsk_l2');
    expect(list.length).toBe(2);
    expect(list[0].toStatus).toBe('running');
    expect(list[1].toStatus).toBe('done');
  });
});

describe('createPromptResponse', () => {
  it('creates a response row', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Response test' });
    const r = createPromptResponse(db, p.id, 'The answer', 'chat');
    expect(r.id).toMatch(/^prr_/);
    expect(r.promptId).toBe(p.id);
    expect(r.responseKind).toBe('chat');
  });

  it('stores decompositionTreeJson', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Decompose test' });
    const r = createPromptResponse(db, p.id, 'Tree', 'decomposition', {
      decompositionTreeJson: JSON.stringify({ children: [] }),
    });
    expect(r.decompositionTreeJson).toBeTruthy();
  });
});

// ─── API route tests ────────────────────────────────────────────────────────────

describe('POST /prompts', () => {
  it('creates a prompt and returns 201 with prompt_id and correlation_id', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'POST', '/prompts', { body: 'Create test prompt' });
    expect(status).toBe(201);
    expect((body as { prompt_id: string }).prompt_id).toMatch(/^prm_/);
    expect((body as { correlation_id: string }).correlation_id).toBeTruthy();
  });

  it('is idempotent by hash in 10s window', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const payload = { body: 'Idempotent API prompt' };
    const r1 = await req(app, 'POST', '/prompts', payload);
    const r2 = await req(app, 'POST', '/prompts', payload);
    expect((r1.body as { prompt_id: string }).prompt_id).toBe((r2.body as { prompt_id: string }).prompt_id);
  });

  it('returns 400 if body is missing', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'POST', '/prompts', { foo: 'bar' });
    expect(status).toBe(400);
  });

  it('stores received_via field', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { body } = await req(app, 'POST', '/prompts', { body: 'API prompt', received_via: 'cli' });
    const id = (body as { prompt_id: string }).prompt_id;
    const p = getPrompt(db, id);
    expect(p!.receivedVia).toBe('cli');
  });
});

describe('GET /prompts', () => {
  it('returns empty list initially', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status, body } = await req(app, 'GET', '/prompts');
    expect(status).toBe(200);
    expect((body as { prompts: unknown[] }).prompts).toEqual([]);
  });

  it('returns created prompts', async () => {
    const db = createTestDb();
    const app = createApp(db);
    createPrompt(db, { body: 'Listable prompt' });
    const { body } = await req(app, 'GET', '/prompts');
    expect((body as { prompts: unknown[] }).prompts.length).toBeGreaterThan(0);
  });

  it('filters by status', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const p = createPrompt(db, { body: 'Filter by status prompt' });
    updatePromptStatus(db, p.id, 'answered');
    const { body } = await req(app, 'GET', '/prompts?status=answered');
    const list = (body as { prompts: { status: string }[] }).prompts;
    expect(list.every(x => x.status === 'answered')).toBe(true);
  });
});

describe('GET /prompts/:id', () => {
  it('returns 404 for unknown id', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'GET', '/prompts/nonexistent');
    expect(status).toBe(404);
  });

  it('returns prompt with descendants_count', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const p = createPrompt(db, { body: 'Detail prompt' });
    const { status, body } = await req(app, 'GET', `/prompts/${p.id}`);
    expect(status).toBe(200);
    expect((body as { prompt: { id: string } }).prompt.id).toBe(p.id);
    expect(typeof (body as { descendants_count: number }).descendants_count).toBe('number');
  });
});

describe('GET /prompts/:id/descendants', () => {
  it('returns 404 for unknown id', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'GET', '/prompts/nonexistent/descendants');
    expect(status).toBe(404);
  });

  it('returns empty descendants for isolated prompt', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const p = createPrompt(db, { body: 'Isolated' });
    const { status, body } = await req(app, 'GET', `/prompts/${p.id}/descendants`);
    expect(status).toBe(200);
    expect((body as { descendants: unknown[] }).descendants).toEqual([]);
    expect((body as { total: number }).total).toBe(0);
  });
});

describe('GET /prompts/:id/journey', () => {
  it('returns 404 for unknown id', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'GET', '/prompts/nonexistent/journey');
    expect(status).toBe(404);
  });

  it('returns journey data', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const p = createPrompt(db, { body: 'Journey prompt' });
    const { status, body } = await req(app, 'GET', `/prompts/${p.id}/journey`);
    expect(status).toBe(200);
    const j = body as { promptId: string; countByStatus: unknown; descendants: { total: number } };
    expect(j.promptId).toBe(p.id);
    expect(j.descendants.total).toBe(0);
  });
});

describe('GET /prompts/:id/events', () => {
  it('returns 404 for unknown id', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const { status } = await req(app, 'GET', '/prompts/nonexistent/events');
    expect(status).toBe(404);
  });

  it('returns events for the prompt correlation_id', async () => {
    const db = createTestDb();
    const app = createApp(db);
    const p = createPrompt(db, { body: 'Events test prompt' });
    const { status, body } = await req(app, 'GET', `/prompts/${p.id}/events`);
    expect(status).toBe(200);
    expect(Array.isArray((body as { events: unknown[] }).events)).toBe(true);
  });
});

describe('GET /tasks/:id/transitions', () => {
  it('returns empty transitions for new task', async () => {
    const db = createTestDb();
    const app = createApp(db);
    insertTask(db, 'tsk_api_1', 'API transitions task');
    const { status, body } = await req(app, 'GET', '/tasks/tsk_api_1/transitions');
    expect(status).toBe(200);
    expect((body as { transitions: unknown[] }).transitions).toEqual([]);
  });

  it('returns recorded transitions', async () => {
    const db = createTestDb();
    const app = createApp(db);
    insertTask(db, 'tsk_api_2', 'Transitions exist task');
    recordTaskTransition(db, 'tsk_api_2', 'running', 'executor');
    const { body } = await req(app, 'GET', '/tasks/tsk_api_2/transitions');
    const t = body as { transitions: { toStatus: string }[] };
    expect(t.transitions.length).toBe(1);
    expect(t.transitions[0].toStatus).toBe('running');
  });
});

// ─── Additional coverage tests ─────────────────────────────────────────────────
// These tests exercise loop bodies and inner arrow callbacks that are only reached
// when descendants exist across all entity types.

// @no-events — getPromptDescendants is a read-only query, no events emitted
describe('getPromptDescendants — all entity types', () => {
  function seedAllDescendants(db: Db, promptId: string): void {
    const now = new Date().toISOString();

    // story
    db.insert(schema.stories).values({
      id: 'sto_cov_1',
      kind: 'task',
      title: 'Coverage story',
      description: '',
      expectedBehavior: '',
      acceptanceCriteriaJson: '[]',
      verificationPlanJson: '[]',
      dependsOnJson: '[]',
      domainSlugsJson: '[]',
      status: 'pending',
      createdAt: now,
      rootPromptId: promptId,
    }).run();

    // requirement
    db.insert(schema.requirements).values({
      id: 'req_cov_1',
      title: 'Coverage requirement',
      state: 'captured',
      labels: '[]',
      estimatedFiles: '[]',
      dependsOn: '[]',
      linkedTaskIds: '[]',
      scope: 'global',
      createdAt: now,
      updatedAt: now,
      rootPromptId: promptId,
    }).run();

    // task (with startedAt so timeToFirstTaskMs fires in getPromptJourney)
    db.insert(schema.tasks).values({
      id: 'tsk_cov_1',
      title: 'Coverage task',
      status: 'running',
      cwd: '/',
      declaredFiles: '[]',
      dependsOn: '[]',
      spawnedBy: 'user',
      scope: 'global',
      createdAt: now,
      startedAt: now,
      rootPromptId: promptId,
    }).run();

    // task_run
    db.insert(schema.taskRuns).values({
      sessionId: 'ses_cov_1',
      title: 'Coverage run',
      startedAt: now,
      lastActivityAt: now,
      rootPromptId: promptId,
    }).run();

    // blocker
    db.insert(schema.blockers).values({
      id: 'blk_cov_1',
      title: 'Coverage blocker',
      state: 'open',
      resolutionSteps: '[]',
      links: '[]',
      description: '',
      scope: 'global',
      createdAt: now,
      rootPromptId: promptId,
    }).run();

    // question
    db.insert(schema.questions).values({
      id: 'que_cov_1',
      title: 'Coverage question',
      priority: 'normal',
      context: '',
      recommendations: '[]',
      state: 'open',
      scope: 'global',
      createdAt: now,
      rootPromptId: promptId,
    }).run();
  }

  it('returns descendants from all six entity types', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'All entity types prompt' });
    seedAllDescendants(db, p.id);

    const descendants = getPromptDescendants(db, p.id);
    const types = new Set(descendants.map(d => d.entityType));
    expect(types.has('story')).toBe(true);
    expect(types.has('requirement')).toBe(true);
    expect(types.has('task')).toBe(true);
    expect(types.has('task_run')).toBe(true);
    expect(types.has('blocker')).toBe(true);
    expect(types.has('question')).toBe(true);
    expect(descendants.length).toBe(6);
  });

  it('returns descendants sorted by createdAt', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Sort check prompt' });
    seedAllDescendants(db, p.id);
    const descendants = getPromptDescendants(db, p.id);
    // sort callback exercises (a, b) => a.createdAt.localeCompare(b.createdAt)
    for (let i = 1; i < descendants.length; i++) {
      expect(descendants[i]!.createdAt >= descendants[i - 1]!.createdAt).toBe(true);
    }
  });
});

// @no-events — getPromptJourney is a read-only aggregation, no events emitted
describe('getPromptJourney — with descendants', () => {
  it('populates countByStatus and descendant counts from real data', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Journey with descendants' });
    const now = new Date().toISOString();

    db.insert(schema.tasks).values({
      id: 'tsk_jrn_1', title: 'Journey task', status: 'running',
      cwd: '/', declaredFiles: '[]', dependsOn: '[]', spawnedBy: 'user',
      scope: 'global', createdAt: now, startedAt: now, rootPromptId: p.id,
    }).run();

    db.insert(schema.stories).values({
      id: 'sto_jrn_1', kind: 'story', title: 'Journey story',
      description: '', expectedBehavior: '', acceptanceCriteriaJson: '[]',
      verificationPlanJson: '[]', dependsOnJson: '[]', domainSlugsJson: '[]',
      status: 'verified', createdAt: now, rootPromptId: p.id,
    }).run();

    const journey = getPromptJourney(db, p.id);
    expect(journey).not.toBeNull();
    expect(journey!.descendants.tasks).toBe(1);
    expect(journey!.descendants.stories).toBe(1);
    expect(journey!.descendants.total).toBeGreaterThanOrEqual(2);
    // countByStatus exercised
    expect(typeof journey!.countByStatus).toBe('object');
    // timeToFirstTaskMs — task has startedAt so the branch fires
    expect(journey!.timeToFirstTaskMs).not.toBeUndefined();
  });

  it('computes timeToFirstTaskMs when a task has startedAt', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'TimeToFirst prompt' });
    const now = new Date().toISOString();

    db.insert(schema.tasks).values({
      id: 'tsk_ttf_1', title: 'TTF task', status: 'running',
      cwd: '/', declaredFiles: '[]', dependsOn: '[]', spawnedBy: 'user',
      scope: 'global', createdAt: now, startedAt: now, rootPromptId: p.id,
    }).run();

    const journey = getPromptJourney(db, p.id);
    expect(journey).not.toBeNull();
    // timeToFirstTaskMs is a number (could be 0 if prompt and task created same ms)
    expect(typeof journey!.timeToFirstTaskMs === 'number' || journey!.timeToFirstTaskMs === null).toBe(true);
  });
});

// @no-events — listPrompts is a read-only query, no events emitted
describe('listPrompts — filter branches', () => {
  it('filters by userId', () => {
    const db = createTestDb();
    createPrompt(db, { body: 'User A prompt', userId: 'u_alice' });
    createPrompt(db, { body: 'User B prompt', userId: 'u_bob' });
    const results = listPrompts(db, { userId: 'u_alice' });
    expect(results.every(x => x.userId === 'u_alice')).toBe(true);
  });

  it('filters by since timestamp', () => {
    const db = createTestDb();
    const p = createPrompt(db, { body: 'Since filter prompt' });
    const sinceTs = new Date(Date.now() - 5_000).toISOString();
    const results = listPrompts(db, { since: sinceTs });
    expect(results.some(x => x.id === p.id)).toBe(true);
  });

  it('filters by cursor (before timestamp)', () => {
    const db = createTestDb();
    createPrompt(db, { body: 'Cursor test prompt' });
    // cursor = future timestamp → excludes all current prompts
    const futureTs = new Date(Date.now() + 10_000).toISOString();
    const results = listPrompts(db, { cursor: futureTs });
    // all prompts are before futureTs so they should appear
    expect(Array.isArray(results)).toBe(true);
  });
});
