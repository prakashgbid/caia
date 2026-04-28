import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OllamaAdapter } from '../src/ollama-adapter.js';

const ORIGINAL_FETCH = globalThis.fetch;

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
    it('POSTs to /api/generate and shapes the response', async () => {
      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'qwen2.5-coder:7b',
          response: 'hello world',
          done: true,
          prompt_eval_count: 10,
          eval_count: 20,
        }),
      } as Response);
      globalThis.fetch = fetchMock;

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

      // Confirm we hit the local Ollama URL — this is the smoke check that
      // routing actually goes to localhost:11434, not the Anthropic API.
      expect(fetchMock).toHaveBeenCalledOnce();
      const url = fetchMock.mock.calls[0]![0] as string;
      expect(url).toBe('http://localhost:11434/api/generate');
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
