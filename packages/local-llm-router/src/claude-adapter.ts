// Claude API adapter — calls Anthropic's REST API directly via fetch.
// No Anthropic SDK import so this package stays dependency-free.

import type {
  ClaudeRequest,
  ClaudeResponse,
  LLMRequest,
  LLMResponse,
} from './types.js';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_API_VERSION = '2023-06-01';

export class ClaudeAdapter {
  private readonly apiKey: string;

  constructor(apiKey: string = process.env['ANTHROPIC_API_KEY'] ?? '') {
    if (!apiKey) {
      throw new Error(
        'ClaudeAdapter requires ANTHROPIC_API_KEY env var or explicit apiKey argument.',
      );
    }
    this.apiKey = apiKey;
  }

  /**
   * Generate a completion via the Anthropic Messages API.
   */
  async generate(
    model: string,
    request: LLMRequest,
  ): Promise<LLMResponse> {
    const start = Date.now();

    const body: ClaudeRequest = {
      model,
      max_tokens: request.maxTokens ?? 4096,
      messages: [{ role: 'user', content: request.prompt }],
      ...(request.systemPrompt ? { system: request.systemPrompt } : {}),
      ...(request.temperature !== undefined
        ? { temperature: request.temperature }
        : {}),
    };

    let res: Response;
    try {
      res = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': ANTHROPIC_API_VERSION,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(120_000),
      });
    } catch (err) {
      throw new Error(`Claude API request failed: ${String(err)}`, { cause: err });
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Claude API error ${res.status}: ${text}`);
    }

    const data = (await res.json()) as ClaudeResponse;

    const text = data.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('');

    return {
      response: text,
      model: data.model,
      provider: 'claude',
      durationMs: Date.now() - start,
      usage: {
        promptTokens: data.usage.input_tokens,
        completionTokens: data.usage.output_tokens,
        totalTokens: data.usage.input_tokens + data.usage.output_tokens,
      },
    };
  }
}
