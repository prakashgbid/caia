// End-to-end smoke test: CAIA orchestrator → @chiefaia/local-llm-router → live Ollama.
//
// Run with:   pnpm --filter @caia-app/core exec ts-node scripts/e2e-llm-route.ts
// Or:         npx ts-node apps/orchestrator/scripts/e2e-llm-route.ts
//
// Skips silently when SKIP_OLLAMA_INTEGRATION=1 (so CI doesn't break).
//
// What it proves:
//   1. The orchestrator's HTTP layer wires up /llm/route.
//   2. Calling that route with a useLocal task dispatches to Ollama.
//   3. Ollama returns a real completion from a local model.
//   4. Total round-trip uses zero Claude API tokens.

import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as path from 'path';
import * as schema from '../src/db/schema';
import { createApp } from '../src/api/app';

const SKIP = process.env['SKIP_OLLAMA_INTEGRATION'] === '1';

interface LLMResponseShape {
  response: string;
  model: string;
  provider: 'local' | 'claude';
  durationMs: number;
}

async function getAvailableModel(): Promise<string | null> {
  try {
    const res = await fetch('http://127.0.0.1:11434/api/tags');
    if (!res.ok) return null;
    const data = (await res.json()) as { models?: Array<{ name: string }> };
    const override = process.env['OLLAMA_TEST_MODEL'];
    if (override && data.models?.some((m) => m.name === override)) return override;
    return data.models?.[0]?.name ?? null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  if (SKIP) {
    console.error('[e2e-llm-route] SKIP_OLLAMA_INTEGRATION=1 — skipping');
    return;
  }

  const model = await getAvailableModel();
  if (!model) {
    console.error('[e2e-llm-route] No Ollama models available — skipping');
    return;
  }

  // For the demo, we patch the routing rule by forcing local with a known taskType.
  // This proves the *plumbing* end-to-end without depending on which model the
  // user has pulled (the routing-config defaults are advisory).
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: path.join(__dirname, '../src/db/migrations') });

  const app = createApp(db);

  console.error(`[e2e-llm-route] POST /llm/route with model=${model}`);
  // We have to monkey-patch the routing rule for the test taskType
  // because the default localModel may not be pulled.
  // Use OLLAMA_TEST_MODEL via the routing-config getRoute fallback + env override.
  process.env['OLLAMA_DEFAULT_MODEL'] = model;

  const startedAt = Date.now();
  const res = await app.request('http://localhost/llm/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      taskType: 'domain-classification',
      prompt:
        'Reply with one word — the most likely domain for "user signs in with email": auth, ui, payments, or other.',
      forceLocal: true,
    }),
  });
  const elapsed = Date.now() - startedAt;

  const body = (await res.json()) as LLMResponseShape | { error: string };
  if (res.status !== 200 || 'error' in body) {
    console.error(`[e2e-llm-route] FAIL: status=${res.status} body=${JSON.stringify(body)}`);
    process.exit(1);
  }

  console.error(`[e2e-llm-route] OK status=${res.status} provider=${body.provider} model=${body.model} latencyMs=${elapsed}`);
  console.error(`[e2e-llm-route] response="${body.response.slice(0, 80)}"`);

  if (body.provider !== 'local') {
    console.error('[e2e-llm-route] FAIL: expected provider=local');
    process.exit(1);
  }
  console.error('[e2e-llm-route] PASS: round-trip used the local model, zero Claude tokens.');
}

main().catch((err) => {
  console.error('[e2e-llm-route] ERROR:', err);
  process.exit(1);
});
