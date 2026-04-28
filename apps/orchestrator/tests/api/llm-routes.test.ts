// Tests for /llm/* routes registered by registerLlmRoutes.
// These follow the same pattern as routes.test.ts (Jest, in-memory SQLite,
// app.request()) so they will run when the orchestrator's jest config is
// un-stubbed.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../../src/db/schema';
import { createApp } from '../../src/api/app';
import { __setAdapters } from '@chiefaia/local-llm-router';
import type { OllamaAdapter, ClaudeAdapter, LLMResponse } from '@chiefaia/local-llm-router';

const MIGRATIONS_DIR = path.join(__dirname, '../../src/db/migrations');

function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: MIGRATIONS_DIR });
  return db as ReturnType<typeof drizzle<typeof schema>>;
}

function fakeOllama(response: Partial<LLMResponse> = {}): OllamaAdapter {
  const r: LLMResponse = {
    response: 'auth',
    model: 'qwen2.5-coder:7b',
    provider: 'local',
    durationMs: 42,
    ...response,
  };
  return {
    isAvailable: async () => true,
    generate: async () => r,
  } as unknown as OllamaAdapter;
}

describe('GET /llm/rules', () => {
  it('returns the routing rule table and cost analysis', async () => {
    const app = createApp(createTestDb());
    const res = await app.request('http://localhost/llm/rules', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: unknown[]; costAnalysis: unknown };
    expect(Array.isArray(body.rules)).toBe(true);
    expect((body.rules as { taskType: string }[]).length).toBeGreaterThan(0);
    expect(body.costAnalysis).toBeDefined();
  });
});

describe('GET /llm/rules/:taskType', () => {
  it('returns the rule for a known task type', async () => {
    const app = createApp(createTestDb());
    const res = await app.request('http://localhost/llm/rules/domain-classification', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { taskType: string; useLocal: boolean };
    expect(body.taskType).toBe('domain-classification');
    expect(body.useLocal).toBe(true);
  });

  it('returns a Claude default for an unknown task type', async () => {
    const app = createApp(createTestDb());
    const res = await app.request('http://localhost/llm/rules/totally-unknown', { method: 'GET' });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { useLocal: boolean };
    expect(body.useLocal).toBe(false);
  });
});

describe('POST /llm/route', () => {
  beforeEach(() => {
    __setAdapters(null, null);
  });

  it('400s when taskType or prompt missing', async () => {
    const app = createApp(createTestDb());
    const res = await app.request('http://localhost/llm/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('routes to local provider for a useLocal: true task', async () => {
    __setAdapters(fakeOllama({ response: 'auth' }), null as unknown as ClaudeAdapter);
    const app = createApp(createTestDb());
    const res = await app.request('http://localhost/llm/route', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        taskType: 'domain-classification',
        prompt: 'classify "user signs in"',
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as LLMResponse;
    expect(body.provider).toBe('local');
    expect(body.response).toBe('auth');
  });
});
