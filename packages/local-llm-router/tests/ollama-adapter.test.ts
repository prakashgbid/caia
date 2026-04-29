import { describe, it, expect, vi, afterEach } from 'vitest';
import { OllamaAdapter } from '../src/ollama-adapter.js';

const ORIGINAL_FETCH = globalThis.fetch;

interface CapturedCall {
  url: string;
  body: Record<string, unknown>;
}

function mockOllamaFetch(
  responses: Record<string, () => unknown>,
  captured: CapturedCall[],
): typeof globalThis.fetch {
  return vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const url = typeof input === 'string' ? input : (input as Request).url;
    const body =
      typeof init?.body === 'string'
        ? (JSON.parse(init.body) as Record<string, unknown>)
        : {};
    captured.push({ url, body });

    const path = new URL(url).pathname;
    const handler = responses[path];
    if (!handler) {
      return new Response('not mocked', { status: 500 });
    }
    return {
      ok: true,
      json: async () => handler(),
    } as Response;
  }) as unknown as typeof globalThis.fetch;
}

describe('OllamaAdapter', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('returns true when /api/tags responds with ok', async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue({ ok: true } as Response);
      const adapter = new OllamaAdapter('http://localhost:11434');
      expect(await adapter.isAvailable()).toBe(true);
    });

    it('returns false when fetch throws', async () => {
      globalThis.fetch = vi
        .fn()
        .mockRejectedValue(new Error('connection refused'));
      const adapter = new OllamaAdapter('http://localhost:11434');
      expect(await adapter.isAvailable()).toBe(false);
    });

    it('returns false when /api/tags responds with a non-OK status', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({ ok: false } as Response);
      const adapter = new OllamaAdapter('http://localhost:11434');
      expect(await adapter.isAvailable()).toBe(false);
    });
  });

  describe('generate', () => {
    it('POSTs to /api/generate and shapes the response for non-thinking models', async () => {
      const captured: CapturedCall[] = [];
      globalThis.fetch = mockOllamaFetch(
        {
          '/api/generate': () => ({
            model: 'qwen2.5-coder:7b',
            response: 'hello world',
            done: true,
            prompt_eval_count: 10,
            eval_count: 20,
          }),
        },
        captured,
      );

      const adapter = new OllamaAdapter('http://localhost:11434');
      const result = await adapter.generate('qwen2.5-coder:7b', {
        taskType: 'domain-classification',
        prompt: 'hi',
        maxTokens: 100,
        temperature: 0.1,
      });

      expect(result.response).toBe('hello world');
      expect(result.model).toBe('qwen2.5-coder:7b');
      expect(result.provider).toBe('local');
      expect(result.usage?.totalTokens).toBe(30);

      // Confirm we hit the local Ollama URL.
      expect(captured).toHaveLength(1);
      expect(captured[0]!.url).toBe('http://localhost:11434/api/generate');
    });

    it('routes Qwen3 to /api/chat with think:false to suppress CoT', async () => {
      // The model catalog flags qwen3:14b as emitsThinkingByDefault. Calling
      // /api/generate would consume eval tokens on chain-of-thought and
      // return an empty response — the chat endpoint with think:false is
      // the documented fix.
      const captured: CapturedCall[] = [];
      globalThis.fetch = mockOllamaFetch(
        {
          '/api/chat': () => ({
            model: 'qwen3:14b',
            message: { role: 'assistant', content: 'auth' },
            done: true,
            prompt_eval_count: 12,
            eval_count: 1,
          }),
        },
        captured,
      );

      const adapter = new OllamaAdapter('http://localhost:11434');
      const result = await adapter.generate('qwen3:14b', {
        taskType: 'domain-classification',
        prompt: 'classify: user signs in with email',
      });

      expect(result.response).toBe('auth');
      expect(result.provider).toBe('local');
      expect(captured).toHaveLength(1);
      expect(captured[0]!.url).toBe('http://localhost:11434/api/chat');
      expect(captured[0]!.body['think']).toBe(false);
      expect(captured[0]!.body['stream']).toBe(false);
      expect(Array.isArray(captured[0]!.body['messages'])).toBe(true);
    });

    it('threads systemPrompt as a system message in chat mode', async () => {
      const captured: CapturedCall[] = [];
      globalThis.fetch = mockOllamaFetch(
        {
          '/api/chat': () => ({
            model: 'qwen3:14b',
            message: { role: 'assistant', content: 'ok' },
            done: true,
          }),
        },
        captured,
      );

      const adapter = new OllamaAdapter('http://localhost:11434');
      await adapter.generate('qwen3:14b', {
        taskType: 'story-enrichment',
        prompt: 'user prompt',
        systemPrompt: 'You are a helpful assistant.',
      });

      const messages = captured[0]!.body['messages'] as Array<{
        role: string;
        content: string;
      }>;
      expect(messages[0]).toEqual({
        role: 'system',
        content: 'You are a helpful assistant.',
      });
      expect(messages[1]).toEqual({ role: 'user', content: 'user prompt' });
    });

    it('forwards keep_alive on /api/generate', async () => {
      const captured: CapturedCall[] = [];
      globalThis.fetch = mockOllamaFetch(
        {
          '/api/generate': () => ({
            model: 'qwen2.5-coder:7b',
            response: 'ok',
            done: true,
          }),
        },
        captured,
      );

      const adapter = new OllamaAdapter(
        'http://localhost:11434',
        '15m',
      );
      await adapter.generate('qwen2.5-coder:7b', {
        taskType: 'domain-classification',
        prompt: 'hi',
      });

      expect(captured[0]!.body['keep_alive']).toBe('15m');
    });

    it('forwards keep_alive on /api/chat', async () => {
      const captured: CapturedCall[] = [];
      globalThis.fetch = mockOllamaFetch(
        {
          '/api/chat': () => ({
            model: 'qwen3:14b',
            message: { role: 'assistant', content: 'ok' },
            done: true,
          }),
        },
        captured,
      );

      const adapter = new OllamaAdapter('http://localhost:11434', '30m');
      await adapter.generate('qwen3:14b', {
        taskType: 'domain-classification',
        prompt: 'hi',
      });

      expect(captured[0]!.body['keep_alive']).toBe('30m');
    });

    it('falls back to /api/generate for tags not in the catalog', async () => {
      const captured: CapturedCall[] = [];
      globalThis.fetch = mockOllamaFetch(
        {
          '/api/generate': () => ({
            model: 'some-future-tag:1b',
            response: 'ok',
            done: true,
          }),
        },
        captured,
      );

      const adapter = new OllamaAdapter('http://localhost:11434');
      await adapter.generate('some-future-tag:1b', {
        taskType: 'domain-classification',
        prompt: 'hi',
      });

      expect(captured[0]!.url).toBe('http://localhost:11434/api/generate');
    });

    it('throws on non-OK response from Ollama', async () => {
      globalThis.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'boom',
      } as Response);
      const adapter = new OllamaAdapter('http://localhost:11434');
      await expect(
        adapter.generate('qwen2.5-coder:7b', {
          taskType: 'domain-classification',
          prompt: 'hi',
        }),
      ).rejects.toThrow(/Ollama API error 500/);
    });
  });
});
