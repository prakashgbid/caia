#!/usr/bin/env ts-node
// Benchmark every catalog model that's pulled. For each model:
//   1. one cold call to load the model (latency reported separately)
//   2. N warm calls (default 3); reports min / median / max wall ms + tok/s
//
// Latency is dominated by cold-load on 14B models (2-5 s). With keep_alive
// (LAI-002) the second and subsequent calls hit a warm slot, so the median
// of the warm runs is the realistic per-call latency to optimize against.
//
// Usage:
//   pnpm --filter @chiefaia/local-llm-router run bench
//   BENCH_WARM_RUNS=5 pnpm bench
//   BENCH_PROMPT_KIND=code pnpm bench
//
// Models are skipped silently when not pulled locally so the script is safe
// to run on any machine — it'll just benchmark whatever is available.

import { MODEL_CATALOG, type LocalModel } from '../src/model-catalog';

const OLLAMA_BASE_URL =
  process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';

const WARM_RUNS = Number(process.env['BENCH_WARM_RUNS'] ?? '3');

const PROMPTS = {
  classify:
    'Reply with a single word — the most likely domain for "user signs in with email": auth, ui, payments, or other.',
  code:
    'Write a TypeScript function that takes a string and returns its sha256 hex digest. No prose, just the function.',
  embed: 'user signs in with email',
} as const;

type PromptKind = keyof typeof PROMPTS;

const PROMPT_KIND: PromptKind =
  ((process.env['BENCH_PROMPT_KIND'] as PromptKind | undefined) ?? 'classify');

interface BenchResult {
  tag: string;
  role: string;
  endpoint: string;
  coldMs: number;
  warmMinMs: number;
  warmMedianMs: number;
  warmMaxMs: number;
  tokensPerSecMedian: number;
  evalCount: number;
  response: string;
  ok: boolean;
  error?: string;
}

interface OllamaTagsResponse {
  models?: Array<{ name: string }>;
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

interface SingleCallResult {
  durationMs: number;
  evalCount: number;
  response: string;
}

async function pulledModelTags(): Promise<Set<string>> {
  const res = await fetch(`${OLLAMA_BASE_URL}/api/tags`);
  if (!res.ok) throw new Error(`/api/tags returned ${res.status}`);
  const data = (await res.json()) as OllamaTagsResponse;
  return new Set((data.models ?? []).map((m) => m.name));
}

async function callGenerate(
  model: LocalModel,
  prompt: string,
): Promise<SingleCallResult> {
  const start = Date.now();
  const res = await fetch(`${OLLAMA_BASE_URL}/api/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.tag,
      prompt,
      stream: false,
      keep_alive: '10m',
      options: { num_predict: 64, temperature: 0 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as OllamaGenerateResponse;
  return {
    durationMs: Date.now() - start,
    evalCount: data.eval_count ?? 0,
    response: data.response.trim(),
  };
}

async function callChat(
  model: LocalModel,
  prompt: string,
): Promise<SingleCallResult> {
  const start = Date.now();
  const res = await fetch(`${OLLAMA_BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: model.tag,
      messages: [{ role: 'user', content: prompt }],
      stream: false,
      think: false,
      keep_alive: '10m',
      options: { num_predict: 64, temperature: 0 },
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as OllamaChatResponse;
  return {
    durationMs: Date.now() - start,
    evalCount: data.eval_count ?? 0,
    response: (data.message?.content ?? '').trim(),
  };
}

async function callEmbeddings(
  model: LocalModel,
  prompt: string,
): Promise<SingleCallResult> {
  const start = Date.now();
  const res = await fetch(`${OLLAMA_BASE_URL}/api/embeddings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: model.tag, prompt }),
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status}: ${await res.text().catch(() => '')}`);
  }
  const data = (await res.json()) as OllamaEmbeddingsResponse;
  return {
    durationMs: Date.now() - start,
    evalCount: data.embedding.length,
    response: `dim=${data.embedding.length}`,
  };
}

function callerFor(model: LocalModel) {
  if (model.endpoint === 'chat') return callChat;
  if (model.endpoint === 'embeddings') return callEmbeddings;
  return callGenerate;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1]! + sorted[mid]!) / 2;
  }
  return sorted[mid]!;
}

async function benchModel(
  model: LocalModel,
  prompt: string,
): Promise<BenchResult> {
  const caller = callerFor(model);
  try {
    const cold = await caller(model, prompt);

    const warmRuns: SingleCallResult[] = [];
    for (let i = 0; i < WARM_RUNS; i++) {
      warmRuns.push(await caller(model, prompt));
    }
    const durations = warmRuns.map((r) => r.durationMs);
    const evalCounts = warmRuns.map((r) => r.evalCount);
    const tokPerSec = warmRuns.map((r) =>
      r.durationMs > 0 ? (r.evalCount * 1000) / r.durationMs : 0,
    );
    const lastWarm = warmRuns[warmRuns.length - 1]!;

    return {
      tag: model.tag,
      role: model.role,
      endpoint: model.endpoint,
      coldMs: cold.durationMs,
      warmMinMs: Math.min(...durations),
      warmMedianMs: median(durations),
      warmMaxMs: Math.max(...durations),
      tokensPerSecMedian: median(tokPerSec),
      evalCount: median(evalCounts),
      response: lastWarm.response.slice(0, 60),
      ok: true,
    };
  } catch (err) {
    return {
      tag: model.tag,
      role: model.role,
      endpoint: model.endpoint,
      coldMs: 0,
      warmMinMs: 0,
      warmMedianMs: 0,
      warmMaxMs: 0,
      tokensPerSecMedian: 0,
      evalCount: 0,
      response: '',
      ok: false,
      error: String(err),
    };
  }
}

async function main(): Promise<void> {
  const prompt =
    PROMPT_KIND === 'embed' ? PROMPTS.embed : PROMPTS[PROMPT_KIND];
  // eslint-disable-next-line no-console
  console.log(
    `[bench] OLLAMA_BASE_URL=${OLLAMA_BASE_URL}, ` +
      `kind=${PROMPT_KIND}, warm_runs=${WARM_RUNS}\n` +
      `[bench] prompt: "${prompt.slice(0, 80)}${prompt.length > 80 ? '...' : ''}"`,
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
    // For the embedding model, only the embed prompt makes sense; everything
    // else gets the chosen prompt kind.
    const useEmbedPrompt = model.endpoint === 'embeddings';
    const promptForModel = useEmbedPrompt ? PROMPTS.embed : prompt;
    // eslint-disable-next-line no-console
    console.log(`[bench] ${model.tag} (cold + ${WARM_RUNS} warm)...`);
    results.push(await benchModel(model, promptForModel));
  }

  // eslint-disable-next-line no-console
  console.log('\n=== Benchmark results (ms; warm = median of N) ===');
  // eslint-disable-next-line no-console
  console.log(
    'tag'.padEnd(24) +
      'role'.padEnd(14) +
      'cold'.padStart(7) +
      'warm_p50'.padStart(10) +
      'warm_min'.padStart(10) +
      'warm_max'.padStart(10) +
      'tok/s'.padStart(8) +
      '  response',
  );
  for (const r of results) {
    const line =
      r.tag.padEnd(24) +
      r.role.padEnd(14) +
      String(r.coldMs).padStart(7) +
      String(r.warmMedianMs).padStart(10) +
      String(r.warmMinMs).padStart(10) +
      String(r.warmMaxMs).padStart(10) +
      r.tokensPerSecMedian.toFixed(1).padStart(8) +
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
