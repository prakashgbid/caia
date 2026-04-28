// Ollama REST adapter — talks to http://localhost:11434
// Does NOT use the ollama npm package; uses plain fetch so there is no extra dependency.

import type {
  LLMRequest,
  LLMResponse,
  OllamaGenerateRequest,
  OllamaGenerateResponse,
} from './types.js';

// Use 127.0.0.1 explicitly rather than `localhost`. On macOS `localhost`
// often resolves to ::1 first; some setups have an SSH tunnel listening on
// IPv6 :11434 that forwards to a *different* host, which silently routes
// our requests to the wrong Ollama. Pinning IPv4 avoids that class of bug.
const OLLAMA_BASE_URL =
  process.env['OLLAMA_BASE_URL'] ?? 'http://127.0.0.1:11434';

export class OllamaAdapter {
  private readonly baseUrl: string;

  constructor(baseUrl: string = OLLAMA_BASE_URL) {
    this.baseUrl = baseUrl;
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
   * Generate a completion via the Ollama /api/generate endpoint.
   */
  async generate(
    model: string,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const start = Date.now();

    const body: OllamaGenerateRequest = {
      model,
      prompt: request.prompt,
      stream: false,
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      options: {
        temperature: request.temperature ?? 0.2,
        ...(request.maxTokens ? { num_predict: request.maxTokens } : {}),
      },
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        // 3-minute hard timeout — large models can be slow on first load
        signal: AbortSignal.timeout(180_000),
      });
    } catch (err) {
      throw new Error(
        `Ollama request failed (is Ollama running?): ${String(err)}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(
        `Ollama API error ${res.status}: ${text}`,
      );
    }

    const data = (await res.json()) as OllamaGenerateResponse;

    return {
      response: data.response,
      model: data.model,
      provider: 'local',
      durationMs: Date.now() - start,
      usage: {
        ...(data.prompt_eval_count !== undefined
          ? { promptTokens: data.prompt_eval_count }
          : {}),
        ...(data.eval_count !== undefined
          ? { completionTokens: data.eval_count }
          : {}),
        totalTokens: (data.prompt_eval_count ?? 0) + (data.eval_count ?? 0),
      },
    };
  }
}
