#!/usr/bin/env ts-node
// Benchmark every catalog model against a small classification fixture and
// print a comparison table (latency, eval count, tok/s, response sample).
//
// Usage:
//   pnpm --filter @chiefaia/local-llm-router run bench
//   OLLAMA_BASE_URL=http://127.0.0.1:11434 \
//     npx ts-node --esm scripts/benchmark-catalog.ts
//
// Models are skipped silently when not pulled locally so the script is safe
// to run on any machine — it'll just benchmark whatever is available.
//
// This is part of LAI-001 (pull better models). LAI-005 (routing-rule
// enrichment) extends the fixture with task-specific prompts and quality
// scoring against a Claude-baseline.

import { MODEL_CATALOG, type LocalModel } from '../src/model-catalog';

const OLLAMA_BASE_URL =
  process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';

const FIXTURE_PROMPT =
  'Reply with a single word — the most likely domain for "user signs in with email": auth, ui, payments, or other.';

interface BenchResult {
  tag: string;
  role: string;
  endpoint: string;
  durationMs: number;
  evalCount: number;
  tokensPerSec: number;
  response: string;
  ok: boolean;
  error?: string;
}

interface OllamaModelEntry {
  name: string;
}
interface OllamaTagsResponse {
  models?: OllamaModelEntry[];
}
interface OllamaGenerateResponse {
  response: string;
  total_duration?: number;
  eval_count?: number;
}
interface OllamaChatResponse {
  message?: { content?: string };
  total_duration?: number;
  eval_count?: number;
}
interface OllamaEmbeddingsResponse {
  embedding: number[];
}

async function pulledModelTags(): Promise<Set<string>> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`/api/tags returned ${res.status}`);
  const data = (await res.json()) as OllamaTagsResponse;
  return new Set((data.models ?? []).map((m) => m.name));
}

async function benchGenerate(model: LocalModel): Promise<BenchResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.tag,
        prompt: FIXTURE_PROMPT,
        stream: false,
        options: { num_predict: 30, temperature: 0 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return resultFromError(model, Date.now() - start, `HTTP ${res.status}`);
    }
    const data = (await res.json()) as OllamaGenerateResponse;
    return resultFromOk(
      model,
      Date.now() - start,
      data.eval_count ?? 0,
      data.response.trim(),
    );
  } catch (err) {
    return resultFromError(model, Date.now() - start, String(err));
  }
}

async function benchChatNoThink(model: LocalModel): Promise<BenchResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.tag,
        messages: [{ role: 'user', content: FIXTURE_PROMPT }],
        stream: false,
        // Suppresses Qwen3's chain-of-thought; harmless for non-think models.
        think: false,
        options: { num_predict: 30, temperature: 0 },
      }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) {
      return resultFromError(model, Date.now() - start, `HTTP ${res.status}`);
    }
    const data = (await res.json()) as OllamaChatResponse;
    return resultFromOk(
      model,
      Date.now() - start,
      data.eval_count ?? 0,
      (data.message?.content ?? '').trim(),
    );
  } catch (err) {
    return resultFromError(model, Date.now() - start, String(err));
  }
}

async function benchEmbeddings(model: LocalModel): Promise<BenchResult> {
  const start = Date.now();
  try {
    const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model.tag,
        prompt: FIXTURE_PROMPT,
      }),
      signal: AbortSignal.timeout(60_000),
    });
    if (!res.ok) {
      return resultFromError(model, Date.now() - start, `HTTP ${res.status}`);
    }
    const data = (await res.json()) as OllamaEmbeddingsResponse;
    return resultFromOk(
      model,
      Date.now() - start,
      data.embedding.length,
      `dim=${data.embedding.length}`,
    );
  } catch (err) {
    return resultFromError(model, Date.now() - start, String(err));
  }
}

function resultFromOk(
  model: LocalModel,
  durationMs: number,
  evalCount: number,
  response: string,
): BenchResult {
  const seconds = durationMs / 1000;
  return {
    tag: model.tag,
    role: model.role,
    endpoint: model.endpoint,
    durationMs,
    evalCount,
    tokensPerSec: seconds > 0 ? evalCount / seconds : 0,
    response: response.slice(0, 60),
    ok: true,
  };
}

function resultFromError(
  model: LocalModel,
  durationMs: number,
  error: string,
): BenchResult {
  return {
    tag: model.tag,
    role: model.role,
    endpoint: model.endpoint,
    durationMs,
    evalCount: 0,
    tokensPerSec: 0,
    response: '',
    ok: false,
    error,
  };
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log(
    `[bench] OLLAMA_BASE_URL=${OLLAMA_BASE_URL}, fixture="${FIXTURE_PROMPT}"`,
  );

  let pulled: Set<string>;
  try {
    pulled = await pulledModelTags();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      `[bench] could not reach Ollama at ${OLLAMA_BASE_URL}: ${String(err)}`,
    );
    process.exitCode = 1;
    return;
  }

  const results: BenchResult[] = [];
  for (const model of MODEL_CATALOG) {
    if (!pulled.has(model.tag) && !pulled.has(`${model.tag}:latest`)) {
      // eslint-disable-next-line no-console
      console.log(`[bench] skipping ${model.tag} (not pulled)`);
      continue;
    }
    // eslint-disable-next-line no-console
    console.log(`[bench] running ${model.tag} via ${model.endpoint} ...`);
    let result: BenchResult;
    if (model.endpoint === 'chat') {
      result = await benchChatNoThink(model);
    } else if (model.endpoint === 'embeddings') {
      result = await benchEmbeddings(model);
    } else {
      result = await benchGenerate(model);
    }
    results.push(result);
  }

  // eslint-disable-next-line no-console
  console.log('\n=== Benchmark results ===');
  // eslint-disable-next-line no-console
  console.log(
    'tag'.padEnd(24) +
      'role'.padEnd(14) +
      'endpoint'.padEnd(12) +
      'ms'.padStart(7) +
      'tok'.padStart(6) +
      'tok/s'.padStart(8) +
      '  response',
  );
  for (const r of results) {
    const line =
      r.tag.padEnd(24) +
      r.role.padEnd(14) +
      r.endpoint.padEnd(12) +
      String(r.durationMs).padStart(7) +
      String(r.evalCount).padStart(6) +
      r.tokensPerSec.toFixed(1).padStart(8) +
      '  ' +
      (r.ok ? r.response : `ERR: ${r.error ?? 'unknown'}`);
    // eslint-disable-next-line no-console
    console.log(line);
  }
}

main().catch((err: unknown) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
