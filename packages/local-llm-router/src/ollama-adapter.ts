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

/**
 * Request timeout when the target model is already loaded ("warm"). 180s is
 * a defensive ceiling — typical warm-call latency is sub-second to a few
 * seconds for 7B/14B models. The cap exists so a hung Ollama doesn't pin a
 * caller indefinitely.
 */
const DEFAULT_REQUEST_TIMEOUT_MS = Number(
  process.env['OLLAMA_REQUEST_TIMEOUT_MS'] ?? 180_000,
);

/**
 * Extended timeout used the FIRST time a given model is requested in-process
 * (RR-3, 2026-05-15). Ollama cold-loads large models lazily and the first
 * call can take 10-30s on M1 Pro for 7B and longer for 14B. The previous
 * adapter shape applied a single conservative timeout to every call; when a
 * tighter caller-side cap was layered above (e.g. classifier with a 5-30s
 * budget) the first dispatch hit TIMEOUT before the model finished loading
 * and the router incorrectly fell through to Claude. Tracking the warm bit
 * here lets the adapter give cold loads a 60s grace window without
 * loosening the warm-call ceiling.
 */
const DEFAULT_FIRST_REQUEST_TIMEOUT_MS = Number(
  process.env['OLLAMA_FIRST_REQUEST_TIMEOUT_MS'] ?? 60_000,
);

/**
 * Timeout for the explicit warmup path (warmup() / POST /admin/warmup).
 * Warmup is allowed more headroom than a regular cold request because it
 * may load a much larger model than the next inference call actually needs
 * (e.g. preheating qwen2.5-coder:14b at daemon start).
 */
const DEFAULT_WARMUP_TIMEOUT_MS = Number(
  process.env['OLLAMA_WARMUP_TIMEOUT_MS'] ?? 120_000,
);

export interface OllamaAdapterOptions {
  baseUrl?: string;
  keepAlive?: string;
  /** Hard cap for a warm in-process request (ms). */
  requestTimeoutMs?: number;
  /** Hard cap for the FIRST in-process request to a given model (ms). */
  firstRequestTimeoutMs?: number;
  /** Hard cap for the explicit warmup path (ms). */
  warmupTimeoutMs?: number;
}

export class OllamaAdapter {
  private readonly baseUrl: string;
  private readonly keepAlive: string;
  private readonly requestTimeoutMs: number;
  private readonly firstRequestTimeoutMs: number;
  private readonly warmupTimeoutMs: number;
  /**
   * Models we have successfully completed at least one request against in
   * this process. The set is per-adapter-instance and per-process — restart
   * resets it, which is the correct behaviour (the daemon's warmup-on-start
   * hook (see bin/router-daemon.ts) refills it). We deliberately do NOT
   * persist this across processes; ollama keeps its own keep_alive window
   * and may have evicted the model since our last call.
   */
  private readonly warmModels = new Set<string>();

  constructor(
    baseUrlOrOptions: string | OllamaAdapterOptions = OLLAMA_BASE_URL,
    keepAlive: string = OLLAMA_KEEP_ALIVE,
  ) {
    if (typeof baseUrlOrOptions === 'string') {
      this.baseUrl = baseUrlOrOptions;
      this.keepAlive = keepAlive;
      this.requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS;
      this.firstRequestTimeoutMs = DEFAULT_FIRST_REQUEST_TIMEOUT_MS;
      this.warmupTimeoutMs = DEFAULT_WARMUP_TIMEOUT_MS;
    } else {
      this.baseUrl = baseUrlOrOptions.baseUrl ?? OLLAMA_BASE_URL;
      this.keepAlive = baseUrlOrOptions.keepAlive ?? OLLAMA_KEEP_ALIVE;
      this.requestTimeoutMs =
        baseUrlOrOptions.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
      this.firstRequestTimeoutMs =
        baseUrlOrOptions.firstRequestTimeoutMs ??
        DEFAULT_FIRST_REQUEST_TIMEOUT_MS;
      this.warmupTimeoutMs =
        baseUrlOrOptions.warmupTimeoutMs ?? DEFAULT_WARMUP_TIMEOUT_MS;
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
   * Whether the adapter believes the named model is already loaded (warm).
   * Exposed primarily for tests and the /admin/warmup endpoint diagnostics —
   * the inference path consults the same flag internally to pick a timeout.
   */
  isWarm(model: string): boolean {
    return this.warmModels.has(model);
  }

  /**
   * Mark a model as warm (or not). Visible for the warmup endpoint and tests.
   * Production code paths set this implicitly by completing a request.
   */
  markWarm(model: string, warm: boolean = true): void {
    if (warm) {
      this.warmModels.add(model);
    } else {
      this.warmModels.delete(model);
    }
  }

  /**
   * Snapshot the current warm-model set. Order is insertion order.
   */
  warmModelList(): string[] {
    return Array.from(this.warmModels);
  }

  /**
   * Explicitly preload a model into Ollama's memory. Used by:
   *   - the router-daemon-start hook (warm on boot)
   *   - the POST /admin/warmup operator endpoint
   *   - tests that want to skip the first-request timeout boost
   *
   * Implementation note: Ollama loads a model on any /api/generate call,
   * including one with an empty prompt. We pass `keep_alive` so the model
   * stays resident for subsequent requests. The request uses the
   * `warmupTimeoutMs` ceiling (default 120s) — generous because cold-loading
   * a 14B model on M1 Pro can take 20-40s.
   *
   * Returns the duration in ms. Throws on timeout or non-OK status — callers
   * that want fire-and-forget should wrap with .catch().
   */
  async warmup(model: string): Promise<{ model: string; durationMs: number }> {
    const start = Date.now();
    const body: OllamaGenerateRequest = {
      model,
      prompt: '',
      stream: false,
      keep_alive: this.keepAlive,
    };
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(this.warmupTimeoutMs),
      });
    } catch (err) {
      throw new Error(
        `Ollama warmup failed for model='${model}' (is Ollama running?): ${String(err)}`,
        { cause: err },
      );
    }
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Ollama warmup error ${res.status}: ${text}`);
    }
    // Drain the body so the connection is reusable. We don't need the payload.
    await res.text().catch(() => '');
    this.warmModels.add(model);
    return { model, durationMs: Date.now() - start };
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
    const start = Date.now();

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

    const res = await this.postJson('/api/generate', body, model);
    const data = (await res.json()) as OllamaGenerateResponse;

    return {
      response: data.response,
      model: data.model,
      provider: 'local',
      durationMs: Date.now() - start,
      usage: this.usageFrom(data.prompt_eval_count, data.eval_count),
    };
  }

  private async generateViaChat(
    model: string,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const start = Date.now();

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

    const res = await this.postJson('/api/chat', body, model);
    const data = (await res.json()) as OllamaChatResponse;

    return {
      response: data.message?.content ?? '',
      model: data.model,
      provider: 'local',
      durationMs: Date.now() - start,
      usage: this.usageFrom(data.prompt_eval_count, data.eval_count),
    };
  }

  /**
   * Pick the right timeout for `model` and POST `body` to `path`. On a
   * successful response (status OK) the model is marked warm so subsequent
   * requests use the (tighter) warm ceiling. On failure the warm flag is
   * untouched — the next call gets another shot at the cold-load window.
   */
  private async postJson(
    path: string,
    body: unknown,
    model: string,
  ): Promise<Response> {
    const warm = this.warmModels.has(model);
    const timeoutMs = warm ? this.requestTimeoutMs : this.firstRequestTimeoutMs;
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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

    // Successful response — model is loaded; subsequent calls in this
    // process can use the tighter warm-call ceiling.
    this.warmModels.add(model);
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
