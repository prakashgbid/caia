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

export class OllamaAdapter {
  private readonly baseUrl: string;
  private readonly keepAlive: string;

  constructor(
    baseUrl: string = OLLAMA_BASE_URL,
    keepAlive: string = OLLAMA_KEEP_ALIVE,
  ) {
    this.baseUrl = baseUrl;
    this.keepAlive = keepAlive;
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

    const res = await this.postJson('/api/generate', body);
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

    const res = await this.postJson('/api/chat', body);
    const data = (await res.json()) as OllamaChatResponse;

    return {
      response: data.message?.content ?? '',
      model: data.model,
      provider: 'local',
      durationMs: Date.now() - start,
      usage: this.usageFrom(data.prompt_eval_count, data.eval_count),
    };
  }

  private async postJson(path: string, body: unknown): Promise<Response> {
    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // 3-minute hard timeout — large models can be slow on first load
        signal: AbortSignal.timeout(180_000),
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
