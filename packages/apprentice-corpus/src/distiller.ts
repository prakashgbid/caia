/**
 * Distiller — pluggable backend.
 *
 * Selected by `DISTILL_BACKEND` env var via {@link createDistiller}:
 *   - `claude-binary` (default, back-compat): subprocess `claude --print`
 *     under the keychain/OAuth subscription path. Cribs from
 *     `@chiefaia/local-llm-router`'s `claude-adapter.ts` (subprocess
 *     pattern + `ANTHROPIC_API_KEY=undefined` to force subscription).
 *   - `local-llm-router`: HTTP POST to a CAIA-internal Ollama proxy at
 *     `http://127.0.0.1:7411/v1/chat/completions` with `qwen2.5-coder:7b`.
 *     Health-checks `/healthz` (2s timeout) before each call; falls back
 *     to claude-binary if unhealthy. Lifts the ~50-distill/day quota
 *     into a free-of-subscription-cost regime so the M3 LaunchAgent can
 *     run with `--max-distill-calls 50` rather than `--no-distill`.
 *
 * The aggregator constructs one of these via {@link createDistiller}
 * (reads `DISTILL_BACKEND` from the resolved env) and treats the result
 * as an opaque {@link ClaudeDistiller}. Per-sample failures are caught
 * by the aggregator and treated as "drop this sample"; the distiller
 * itself must throw on every error path.
 */

import { spawnSync } from 'node:child_process';

import type {
  ClaudeDistiller,
  DistillInput,
  DistillOutput
} from './types.js';

export interface DefaultDistillerOptions {
  binaryPath: string;
  timeoutMs?: number;
  /** Test seam — replace `child_process.spawnSync`. */
  spawnFn?: typeof spawnSync;
  /** Optional model override. Default: claude-haiku-4-5 (cheap; distillation is not reasoning). */
  model?: string;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export const LOCAL_LLM_ROUTER_DEFAULT_URL = 'http://127.0.0.1:7411';
export const LOCAL_LLM_ROUTER_DEFAULT_MODEL = 'qwen2.5-coder:7b';
const HEALTH_CHECK_TIMEOUT_MS = 2_000;

export const DISTILL_PROMPT_TEMPLATE = `You are extracting a high-quality instruction-response pair for fine-tuning a coding agent.

Given the raw artifact below, produce a clean Q/A pair that captures the substantive content.

Rules:
- Drop voice-transcription noise (um, uh, you know).
- Keep operator decisions verbatim.
- Strip any credentials or personally-identifying patterns you spot.
- The instruction should be a clear question or task; the response should answer it directly.
- Output STRICT JSON exactly in the shape: {"instruction": "...", "response": "..."}.
- No prose before or after the JSON.

Raw artifact source: {source}/{kind}
Raw artifact:
"""
{text}
"""`;

function renderPrompt(input: DistillInput): string {
  return DISTILL_PROMPT_TEMPLATE
    .replace('{source}', input.source)
    .replace('{kind}', input.kind ?? 'unknown')
    .replace('{text}', input.text);
}

/**
 * Build a default distiller backed by the `claude` CLI.
 *
 * Honours `feedback_no_api_key_billing.md` — explicitly nukes
 * `ANTHROPIC_API_KEY` from the spawned env so the binary falls
 * through to the keychain / OAuth subscription session.
 */
export function createDefaultDistiller(opts: DefaultDistillerOptions): ClaudeDistiller {
  const spawn = opts.spawnFn ?? spawnSync;
  const timeout = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = opts.model ?? DEFAULT_MODEL;

  return {
    async distill(input: DistillInput): Promise<DistillOutput> {
      const prompt = renderPrompt(input);

      const env = { ...process.env };
      delete env['ANTHROPIC_API_KEY'];

      const result = spawn(
        opts.binaryPath,
        ['--print', '--output-format', 'json', '--model', model],
        {
          input: prompt,
          encoding: 'utf-8',
          timeout,
          env
        }
      );

      if (result.error !== null && result.error !== undefined) {
        throw new Error(`distiller spawn failed: ${result.error.message}`);
      }
      if (result.status !== 0) {
        throw new Error(
          `distiller exited ${result.status}: ${(result.stderr ?? '').toString().slice(0, 300)}`
        );
      }
      const stdout = (result.stdout ?? '').toString();
      return parseDistillerOutput(stdout);
    }
  };
}

export interface LocalLlmRouterDistillerOptions {
  /** Base URL of the router. Default `http://127.0.0.1:7411`. */
  routerUrl?: string;
  /** Model id passed to `/v1/chat/completions`. Default `qwen2.5-coder:7b`. */
  model?: string;
  /** Overall request timeout for the chat completion call. */
  timeoutMs?: number;
  /** Health-check timeout (GET /healthz). Default 2s. */
  healthCheckTimeoutMs?: number;
  /**
   * Fallback distiller used when `/healthz` is not OK. Required: the
   * migration plan mandates falling back to the claude-binary path
   * rather than dropping the sample, so the corpus pipeline degrades
   * gracefully when the router is restarted or stopped.
   */
  fallback: ClaudeDistiller;
  /** Test seam — replace global `fetch`. */
  fetchFn?: typeof fetch;
}

/**
 * Local-LLM-router distiller. POSTs to `<routerUrl>/v1/chat/completions`
 * with the OpenAI chat-completions shape after a fast health check.
 *
 * Health-check failure → delegate to `fallback`. Any other error
 * (request timeout, non-2xx, malformed response, JSON parse failure)
 * throws, which the aggregator treats as "drop this sample" (same
 * behaviour as the claude-binary path).
 */
export function createLocalLlmRouterDistiller(
  opts: LocalLlmRouterDistillerOptions
): ClaudeDistiller {
  const baseUrl = (opts.routerUrl ?? LOCAL_LLM_ROUTER_DEFAULT_URL).replace(/\/+$/, '');
  const model = opts.model ?? LOCAL_LLM_ROUTER_DEFAULT_MODEL;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const healthTimeoutMs = opts.healthCheckTimeoutMs ?? HEALTH_CHECK_TIMEOUT_MS;
  const doFetch: typeof fetch = opts.fetchFn ?? ((globalThis as { fetch: typeof fetch }).fetch);

  return {
    async distill(input: DistillInput): Promise<DistillOutput> {
      const healthy = await routerHealthy(doFetch, `${baseUrl}/healthz`, healthTimeoutMs);
      if (!healthy) {
        return opts.fallback.distill(input);
      }

      const prompt = renderPrompt(input);
      const ctrl = new AbortController();
      const to = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await doFetch(`${baseUrl}/v1/chat/completions`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.1
          }),
          signal: ctrl.signal
        });
      } catch (e) {
        throw new Error(`local-llm-router request failed: ${(e as Error).message}`, { cause: e });
      } finally {
        clearTimeout(to);
      }

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`local-llm-router responded ${res.status}: ${text.slice(0, 300)}`);
      }
      let body: unknown;
      try {
        body = await res.json();
      } catch (e) {
        throw new Error(`local-llm-router body not JSON: ${(e as Error).message}`, { cause: e });
      }
      const content = extractChatCompletionContent(body);
      return parseInstructionJson(content);
    }
  };
}

async function routerHealthy(
  doFetch: typeof fetch,
  url: string,
  timeoutMs: number
): Promise<boolean> {
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { method: 'GET', signal: ctrl.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(to);
  }
}

function extractChatCompletionContent(body: unknown): string {
  if (typeof body !== 'object' || body === null) {
    throw new Error('local-llm-router body not an object');
  }
  const choices = (body as { choices?: unknown }).choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error('local-llm-router body missing choices[]');
  }
  const first = choices[0] as { message?: { content?: unknown } } | undefined;
  const content = first?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('local-llm-router choices[0].message.content not a string');
  }
  return content;
}

/**
 * Parse the `claude --print --output-format json` envelope, then the
 * inner JSON the distillation prompt asked for.
 *
 * The outer envelope is `{ "result": "..." }` per claude-adapter.ts.
 * The inner JSON is what the prompt template instructed.
 */
export function parseDistillerOutput(stdout: string): DistillOutput {
  let outer: unknown;
  try {
    outer = JSON.parse(stdout);
  } catch (e) {
    throw new Error(`distiller stdout not JSON: ${(e as Error).message}`, { cause: e });
  }
  if (
    typeof outer !== 'object'
    || outer === null
    || typeof (outer as { result?: unknown }).result !== 'string'
  ) {
    throw new Error('distiller envelope missing "result" string');
  }
  return parseInstructionJson((outer as { result: string }).result);
}

/**
 * Parse a `{instruction, response}` JSON object from a string that may
 * carry leading prose, code fences, or trailing whitespace. Local
 * Ollama-served models reliably wrap JSON in ```json fences despite
 * the prompt's "no prose" instruction, so we strip those defensively
 * before parsing.
 */
export function parseInstructionJson(raw: string): DistillOutput {
  const trimmed = raw.trim();
  const candidates = jsonCandidates(trimmed);
  let lastErr: Error | null = null;
  for (const c of candidates) {
    try {
      const parsed = JSON.parse(c) as unknown;
      if (
        typeof parsed === 'object'
        && parsed !== null
        && typeof (parsed as { instruction?: unknown }).instruction === 'string'
        && typeof (parsed as { response?: unknown }).response === 'string'
      ) {
        const obj = parsed as { instruction: string; response: string };
        return { instruction: obj.instruction, response: obj.response };
      }
      lastErr = new Error('parsed JSON missing instruction/response strings');
    } catch (e) {
      lastErr = e as Error;
    }
  }
  throw new Error(
    `distiller inner JSON parse failed: ${lastErr?.message ?? 'no candidates'}`,
    { cause: lastErr ?? undefined }
  );
}

function jsonCandidates(s: string): string[] {
  const out: string[] = [s];
  const fenced = stripCodeFence(s);
  if (fenced !== s) out.push(fenced);
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) {
    out.push(s.slice(first, last + 1));
  }
  return out;
}

function stripCodeFence(s: string): string {
  const m = s.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return m?.[1] !== undefined ? m[1].trim() : s;
}

export interface CreateDistillerOptions {
  /** Value of `DISTILL_BACKEND`; `undefined` → claude-binary back-compat. */
  backend?: string | undefined;
  /** Path to the `claude` binary (used by claude-binary backend + as fallback). */
  claudeBinaryPath: string;
  /** Optional router URL override (default `http://127.0.0.1:7411`). */
  routerUrl?: string;
  /** Optional router model override (default `qwen2.5-coder:7b`). */
  routerModel?: string;
  /** Test seam — replace `spawnSync` for the claude-binary backend. */
  spawnFn?: typeof spawnSync;
  /** Test seam — replace `fetch` for the local-llm-router backend. */
  fetchFn?: typeof fetch;
}

/**
 * Backend-selecting factory.
 *
 * Reads {@link CreateDistillerOptions.backend} (caller passes
 * `process.env.DISTILL_BACKEND`). Unrecognised values fall back to
 * `claude-binary` for safety — the corpus pipeline must remain
 * functional even if the env var is mistyped.
 */
export function createDistiller(opts: CreateDistillerOptions): ClaudeDistiller {
  const claudeBinary = createDefaultDistiller({
    binaryPath: opts.claudeBinaryPath,
    ...(opts.spawnFn !== undefined ? { spawnFn: opts.spawnFn } : {})
  });
  const backend = (opts.backend ?? 'claude-binary').toLowerCase();
  if (backend === 'local-llm-router') {
    return createLocalLlmRouterDistiller({
      ...(opts.routerUrl !== undefined ? { routerUrl: opts.routerUrl } : {}),
      ...(opts.routerModel !== undefined ? { model: opts.routerModel } : {}),
      ...(opts.fetchFn !== undefined ? { fetchFn: opts.fetchFn } : {}),
      fallback: claudeBinary
    });
  }
  return claudeBinary;
}

/** Always-throw stub for tests / disabled distillation. */
export const noopDistiller: ClaudeDistiller = {
  async distill(): Promise<never> {
    throw new Error('distiller-disabled');
  }
};
