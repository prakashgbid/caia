// Ollama REST adapter — talks to http://localhost:11434
// Does NOT use the ollama npm package; uses plain fetch so there is no extra dependency.

import { getModel } from './model-catalog.js';
import type {
  LLMRequest,
  LLMResponse,
  OllamaChatRequest,
  OllamaChatResponse,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
} from './types.js';

// Use 127.0.0.1 explicitly rather than `localhost`. On macOS `localhost`
// often resolves to ::1 first; some setups have an SSH tunnel listening on
// IPv6 :11434 that forwards to a *different* host, which silently routes
// our requests to the wrong Ollama. Pinning IPv4 avoids that class of bug.
const OLLAMA_BASE_URL =
  process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';

/**
 * How long Ollama should keep a model loaded after a request. Format follows
 * Go's time.ParseDuration ("10m", "1h"); "-1" means "keep loaded indefinitely".
 *
 * Why this matters (LAI-002): the cold-load cost on a 14B model is 2-5 s on
 * M1 Pro. Without a warm window the first call after each idle period eats
 * that latency. Default 10m keeps frequently-used models hot without
 * permanently starving the OS of RAM.
 */
const OLLAMA_KEEP_ALIVE = process.env['OLLAMA_KEEP_ALIVE'] ?? '10m';

// RR-3 (2026-05-16) — cold-start timeout budget.
//
// Bug: cross-host cold-start failure rate was 80% with the historical 10 s
// caller budget and dropped to 0% at 60 s. Root cause is Ollama's
// model-load latency — qwen2.5-coder:14b alone takes ~12 s on M1 Pro the
// first time it's pulled into VRAM after an idle period; 32b/70b models
// can take 30-45 s. The adapter previously applied a flat 180 s ceiling,
// but callers above it (canonical-suite-v2, prompt-optimizer Stage 2/3,
// MCP shims) set their own 10–30 s socket timeouts so the round-trip was
// killed long before Ollama's spinning-up reply landed.
//
// Fix: track per-model warm state inside the adapter and split the
// outbound `fetch` timeout into a *cold* budget (default 60 s — the
// observed 0%-failure point) and a *warm* budget (default 30 s — covers
// generation time on a loaded model with comfortable headroom).
// Successful generate / chat calls mark the model warm; explicit
// `warmup()` / `POST /admin/warmup` does the same without serving a
// real prompt. Warm state TTL matches keep_alive (10 min default).
const COLD_TIMEOUT_MS = numericEnv('ROUTER_OLLAMA_COLD_TIMEOUT_MS', 60_000);
const WARM_TIMEOUT_MS = numericEnv('ROUTER_OLLAMA_WARM_TIMEOUT_MS', 30_000);
const WARM_TTL_MS = numericEnv('ROUTER_OLLAMA_WARM_TTL_MS', 600_000);

function numericEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

export interface OllamaAdapterOptions {
  baseUrl?: string;
  keepAlive?: string;
  /** Cold-start request timeout, ms. Defaults to ROUTER_OLLAMA_COLD_TIMEOUT_MS or 60s. */
  coldTimeoutMs?: number;
  /** Warm-model request timeout, ms. Defaults to ROUTER_OLLAMA_WARM_TIMEOUT_MS or 30s. */
  warmTimeoutMs?: number;
  /** How long a model stays "warm" after last successful use, ms. Defaults to 10 min. */
  warmTtlMs?: number;
  /** Test seam: clock function returning epoch ms. Defaults to `Date.now`. */
  now?: () => number;
}

export class OllamaAdapter {
  private readonly baseUrl: string;
  private readonly keepAlive: string;
  private readonly coldTimeoutMs: number;
  private readonly warmTimeoutMs: number;
  private readonly warmTtlMs: number;
  private readonly now: () => number;
  /** model tag → epoch-ms of last successful request (or warmup) */
  private readonly warmAt: Map<string, number> = new Map();

  constructor(
    baseUrlOrOptions: string | OllamaAdapterOptions = OLLAMA_BASE_URL,
    keepAlive: string = OLLAMA_KEEP_ALIVE,
  ) {
    if (typeof baseUrlOrOptions === 'string') {
      this.baseUrl = baseUrlOrOptions;
      this.keepAlive = keepAlive;
      this.coldTimeoutMs = COLD_TIMEOUT_MS;
      this.warmTimeoutMs = WARM_TIMEOUT_MS;
      this.warmTtlMs = WARM_TTL_MS;
      this.now = Date.now;
    } else {
      this.baseUrl = baseUrlOrOptions.baseUrl ?? OLLAMA_BASE_URL;
      this.keepAlive = baseUrlOrOptions.keepAlive ?? OLLAMA_KEEP_ALIVE;
      this.coldTimeoutMs = baseUrlOrOptions.coldTimeoutMs ?? COLD_TIMEOUT_MS;
      this.warmTimeoutMs = baseUrlOrOptions.warmTimeoutMs ?? WARM_TIMEOUT_MS;
      this.warmTtlMs = baseUrlOrOptions.warmTtlMs ?? WARM_TTL_MS;
      this.now = baseUrlOrOptions.now ?? Date.now;
    }
  }

  /**
   * Check whether the local Ollama daemon is reachable.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2_000),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * RR-3 — returns true when the adapter has a fresh (≤warmTtlMs) success
   * recorded for `model`. The router uses this in /admin/warmup responses
   * and tests assert on it directly.
   */
  isModelWarm(model: string): boolean {
    const ts = this.warmAt.get(model);
    if (ts === undefined) return false;
    return this.now() - ts <= this.warmTtlMs;
  }

  /**
   * RR-3 — list of currently-warm model tags, freshest first. Snapshot;
   * caller may mutate freely.
   */
  getWarmModels(): string[] {
    const cutoff = this.now() - this.warmTtlMs;
    return [...this.warmAt.entries()]
      .filter(([, ts]) => ts >= cutoff)
      .sort((a, b) => b[1] - a[1])
      .map(([m]) => m);
  }

  /**
   * RR-3 — explicitly warm a model. Posts a zero-prompt `/api/generate`
   * with the configured keep_alive so Ollama loads the weights into VRAM
   * but doesn't burn tokens on a synthetic prompt. On success the model
   * is marked warm; the next `generate()` call will use the warm-timeout
   * budget. Failure throws (so the operator/admin endpoint can surface
   * it). Always uses the cold-timeout budget.
   */
  async warmup(model: string): Promise<{ model: string; warmedMs: number }> {
    const start = this.now();
    const body: OllamaGenerateRequest = {
      model,
      prompt: '',
      stream: false,
      keep_alive: this.keepAlive,
      options: { temperature: 0 },
    };
    await this.postJson('/api/generate', body, this.coldTimeoutMs);
    this.markWarm(model);
    return { model, warmedMs: this.now() - start };
  }

  /**
   * Generate a completion from a local model. Picks the right Ollama endpoint
   * based on the model catalog: chat-mode for models that emit chain-of-
   * thought tokens by default (Qwen3 family), generate-mode for everything
   * else. Falls back to /api/generate for unknown tags so the adapter
   * remains usable for tags not yet in the catalog.
   */
  async generate(
    model: string,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const catalogEntry = getModel(model);

    // Qwen3 emits thinking tokens by default; calling /api/generate returns
    // empty response strings while eval_count is consumed by the chain of
    // thought. The chat endpoint with think:false is the documented escape
    // hatch (https://qwen.readthedocs.io/en/latest/getting_started/...).
    if (
      catalogEntry?.endpoint === 'chat' ||
      catalogEntry?.emitsThinkingByDefault
    ) {
      return this.generateViaChat(model, request);
    }

    return this.generateViaGenerate(model, request);
  }

  private async generateViaGenerate(
    model: string,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const start = this.now();

    const body: OllamaGenerateRequest = {
      model,
      prompt: request.prompt,
      stream: false,
      keep_alive: this.keepAlive,
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      options: {
        temperature: request.temperature ?? 0.2,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    const res = await this.postJson('/api/generate', body, this.timeoutFor(model));
    const data = (await res.json()) as OllamaGenerateResponse;

    this.markWarm(model);
    return {
      response: data.response,
      model: data.model,
      provider: 'local',
      durationMs: this.now() - start,
      usage: this.usageFrom(data.prompt_eval_count, data.eval_count),
    };
  }

  private async generateViaChat(
    model: string,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const start = this.now();

    const body: OllamaChatRequest = {
      model,
      messages: [
        ...(request.systemPrompt
          ? [{ role: 'system' as const, content: request.systemPrompt }]
          : []),
        { role: 'user' as const, content: request.prompt },
      ],
      stream: false,
      // Suppress chain-of-thought emission. Ollama ignores `think` for
      // models that don't support it, so this is safe for non-thinking tags.
      think: false,
      keep_alive: this.keepAlive,
      options: {
        temperature: request.temperature ?? 0.2,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    const res = await this.postJson('/api/chat', body, this.timeoutFor(model));
    const data = (await res.json()) as OllamaChatResponse;

    this.markWarm(model);
    return {
      response: data.message?.content ?? '',
      model: data.model,
      provider: 'local',
      durationMs: this.now() - start,
      usage: this.usageFrom(data.prompt_eval_count, data.eval_count),
    };
  }

  private timeoutFor(model: string): number {
    return this.isModelWarm(model) ? this.warmTimeoutMs : this.coldTimeoutMs;
  }

  private markWarm(model: string): void {
    this.warmAt.set(model, this.now());
  }

  private async postJson(path: string, body: unknown, timeoutMs: number): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // RR-3 — cold vs warm budget. Cold (default 60 s) covers Ollama
        // model-load on M1 Pro; warm (default 30 s) covers generation
        // time on an already-loaded model.
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      throw new Error(
        `Ollama request failed (is Ollama running?): ${String(err)}`,
        { cause: err },
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama API error ${res.status}: ${text}`);
    }

    return res;
  }

  private usageFrom(
    promptTokens: number | undefined,
    completionTokens: number | undefined,
  ): NonNullable<LLMResponse['usage']> {
    return {
      ...(promptTokens !== undefined ? { promptTokens } : {}),
      ...(completionTokens !== undefined ? { completionTokens } : {}),
      totalTokens: (promptTokens ?? 0) + (completionTokens ?? 0),
    };
  }
}
