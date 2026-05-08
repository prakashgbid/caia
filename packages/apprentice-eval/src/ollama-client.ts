/**
 * ollama-client — adapter-aware /api/generate client.
 *
 * Per DESIGN.md §6. We POST to `<ollamaBaseUrl>/api/generate` with
 * `{ model, adapter?, prompt, stream: false, options: { seed, temperature } }`.
 *
 * Concurrency is capped externally (harness sequences calls). This module
 * is a thin transport — it does NOT loop, retry, or batch.
 *
 * Adapter-support detection: query GET /api/version. If parseable, fetch
 * /api/show against the base model and look at its capabilities. We use
 * a conservative heuristic — assume support if the version string parses
 * to ≥ 0.4.x.
 */

import type { GenerateRequest, GenerateResult, OllamaClient } from './types.js';

interface OllamaGenerateBody {
  model: string;
  prompt: string;
  stream: false;
  adapter?: string;
  options?: {
    seed?: number;
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaGenerateResponse {
  model?: string;
  response?: string;
  done?: boolean;
  total_duration?: number;
}

interface OllamaVersionResponse {
  version?: string;
}

export interface CreateOllamaClientOpts {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly perPromptTimeoutMs?: number;
}

const MIN_ADAPTER_VERSION_MAJOR = 0;
const MIN_ADAPTER_VERSION_MINOR = 4;

function parseSemver(s: string): { major: number; minor: number; patch: number } | null {
  const m = /^(\d+)\.(\d+)\.(\d+)/.exec(s);
  if (!m) return null;
  return {
    major: Number(m[1]),
    minor: Number(m[2]),
    patch: Number(m[3])
  };
}

function meetsAdapterVersion(version: string): boolean {
  const v = parseSemver(version);
  if (!v) return false;
  if (v.major > MIN_ADAPTER_VERSION_MAJOR) return true;
  if (v.major < MIN_ADAPTER_VERSION_MAJOR) return false;
  return v.minor >= MIN_ADAPTER_VERSION_MINOR;
}

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export function createOllamaClient(opts: CreateOllamaClientOpts): OllamaClient {
  const baseUrl = opts.baseUrl.replace(/\/+$/, '');
  const fetchImpl = opts.fetchImpl ?? fetch;
  const defaultTimeout = opts.perPromptTimeoutMs ?? 90_000;

  return {
    async ping() {
      const res = await fetchWithTimeout(`${baseUrl}/api/tags`, { method: 'GET' }, 5_000, fetchImpl);
      if (!res.ok) {
        throw new Error(`[apprentice-eval] Ollama ping failed: HTTP ${res.status}`);
      }
    },

    async supportsAdapters() {
      try {
        const res = await fetchWithTimeout(
          `${baseUrl}/api/version`,
          { method: 'GET' },
          5_000,
          fetchImpl
        );
        if (!res.ok) return false;
        const json = (await res.json()) as OllamaVersionResponse;
        if (!json.version) return false;
        return meetsAdapterVersion(json.version);
      } catch {
        return false;
      }
    },

    async generate(req: GenerateRequest): Promise<GenerateResult> {
      const body: OllamaGenerateBody = {
        model: req.model,
        prompt: req.prompt,
        stream: false,
        ...(req.adapter ? { adapter: req.adapter } : {}),
        options: {
          ...(req.seed !== undefined ? { seed: req.seed } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {})
        }
      };
      const t0 = Date.now();
      const res = await fetchWithTimeout(
        `${baseUrl}/api/generate`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        },
        req.timeoutMs ?? defaultTimeout,
        fetchImpl
      );
      if (!res.ok) {
        throw new Error(`[apprentice-eval] Ollama /api/generate failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as OllamaGenerateResponse;
      const elapsedMs = Date.now() - t0;
      return {
        output: json.response ?? '',
        elapsedMs,
        model: req.model,
        ...(req.adapter !== undefined ? { adapter: req.adapter } : {}),
        provider: 'ollama',
        ...(req.seed !== undefined ? { seed: req.seed } : {})
      };
    }
  };
}

export const __TEST_ONLY = { meetsAdapterVersion, parseSemver };
