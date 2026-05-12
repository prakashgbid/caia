// Stage 2 — tool-output summarisation via local-llm-router.
//
// Each tool-output blob is POSTed to the router's /v1/chat/completions
// endpoint with `model: qwen2.5-coder:7b` and a fixed compression-style
// system prompt. The router handles model warmup, tier selection, caching.
//
// If the router is unreachable or returns an error, Stage 2 passes the
// blob through unchanged and records the failure on the metrics object.
// The pipeline is best-effort — a missing router degrades quality but
// never blocks routing.
//
// Timeout: the per-blob router call is bounded by STAGE2_TIMEOUT_MS,
// read from `process.env.STAGE2_TIMEOUT_MS` (default 60_000 ms). Real
// 7b summarize calls on a busy local model can take 10–30 s, so the
// previous 8 s hardcoded ceiling aborted most live calls. Callers can
// still override per-invocation via `opts.timeoutMs`.
//
// Phase 5 of the Local-AI-First build chain.

import type { ToolOutputBlob } from './types.js';
import { estimateTokens } from './types.js';

export interface Stage2Options {
  routerBaseUrl?: string;
  model?: string;
  targetRatio?: number; // 0.4 = keep 40% of original tokens
  timeoutMs?: number;
  // Below this raw token count, the blob is passed through unchanged
  // (compression is net loss for short blobs).
  minTokensToCompress?: number;
  // Injectable fetch for tests.
  fetchImpl?: typeof fetch;
}

export interface Stage2BlobResult {
  id: string;
  content: string;
  tokensIn: number;
  tokensOut: number;
  compressed: boolean;
  error?: string | undefined;
}

export const STAGE2_TIMEOUT_MS = parseInt(process.env.STAGE2_TIMEOUT_MS ?? '60000', 10);

const DEFAULTS: Required<Omit<Stage2Options, 'fetchImpl'>> = {
  routerBaseUrl: 'http://127.0.0.1:7411',
  model: 'qwen2.5-coder:7b',
  targetRatio: 0.4,
  timeoutMs: STAGE2_TIMEOUT_MS,
  minTokensToCompress: 200,
};

const SYSTEM_PROMPT_TEMPLATE = (targetRatio: number) =>
  `You are a lossless-summarize tool. Given a tool-output blob, produce a compressed version that:
- Preserves every named entity wrapped in «protected:…» markers verbatim, including the markers themselves.
- Preserves every file path, function name, error message, line number, identifier, and numeric literal.
- Drops boilerplate, repeated examples, decorative text, and verbose log preamble.
- Targets ~${Math.round(targetRatio * 100)}% of the original length.

Output ONLY the compressed text. No commentary, no preamble, no markdown fences.`;

export async function stage2Summarize(
  blobs: ToolOutputBlob[],
  opts: Stage2Options = {},
): Promise<{ blobs: Stage2BlobResult[]; wallMs: number; error?: string | undefined }> {
  const o = { ...DEFAULTS, ...opts };
  const fetcher = opts.fetchImpl ?? fetch;
  const startedAt = Date.now();

  const results: Stage2BlobResult[] = [];
  let aggregateError: string | undefined;

  for (const blob of blobs) {
    const tokensIn = estimateTokens(blob.content);
    if (tokensIn < o.minTokensToCompress) {
      results.push({
        id: blob.id,
        content: blob.content,
        tokensIn,
        tokensOut: tokensIn,
        compressed: false,
      });
      continue;
    }

    try {
      const compressed = await callRouter(blob.content, o, fetcher);
      const tokensOut = estimateTokens(compressed);
      // Sanity: if the router returned >120% of input, treat as a no-op.
      // Models occasionally hallucinate "I will compress…" preambles.
      if (tokensOut > tokensIn * 1.2) {
        results.push({
          id: blob.id,
          content: blob.content,
          tokensIn,
          tokensOut: tokensIn,
          compressed: false,
          error: 'router-expansion-ignored',
        });
        continue;
      }
      results.push({
        id: blob.id,
        content: compressed,
        tokensIn,
        tokensOut,
        compressed: true,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      aggregateError = aggregateError ?? msg;
      results.push({
        id: blob.id,
        content: blob.content,
        tokensIn,
        tokensOut: tokensIn,
        compressed: false,
        error: msg,
      });
    }
  }

  return {
    blobs: results,
    wallMs: Date.now() - startedAt,
    error: aggregateError,
  };
}

async function callRouter(
  content: string,
  opts: Required<Omit<Stage2Options, 'fetchImpl'>>,
  fetcher: typeof fetch,
): Promise<string> {
  const url = `${opts.routerBaseUrl.replace(/\/$/, '')}/v1/chat/completions`;
  const body = {
    model: opts.model,
    messages: [
      { role: 'system' as const, content: SYSTEM_PROMPT_TEMPLATE(opts.targetRatio) },
      { role: 'user' as const, content },
    ],
    temperature: 0.0,
    // Cap output by raw token target with generous slack (×1.5 for the
    // model's tokenizer-vs-char-estimate gap).
    max_tokens: Math.ceil(estimateTokens(content) * opts.targetRatio * 1.5),
    x_router: {
      origin: 'prompt-optimizer-stage2',
      force_tier: 'local-7b',
      risk: false,
      latency_budget_ms: opts.timeoutMs,
    },
  };

  const controller = new AbortController();
  const timeoutHandle = setTimeout(() => controller.abort(), opts.timeoutMs);

  try {
    const resp = await fetcher(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!resp.ok) {
      throw new Error(`router-status-${resp.status}`);
    }
    const data = (await resp.json()) as RouterChatResponse;
    const out = data?.choices?.[0]?.message?.content;
    if (typeof out !== 'string' || out.length === 0) {
      throw new Error('router-empty-response');
    }
    return out.trim();
  } finally {
    clearTimeout(timeoutHandle);
  }
}

interface RouterChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
}
