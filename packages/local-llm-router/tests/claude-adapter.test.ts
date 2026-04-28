import { describe, it, expect, vi, afterEach } from 'vitest';
import { ClaudeAdapter } from '../src/claude-adapter.js';

const ORIGINAL_FETCH = globalThis.fetch;

describe('ClaudeAdapter', () => {
  afterEach(() => {
    globalThis.fetch = ORIGINAL_FETCH;
    vi.restoreAllMocks();
  });

  it('throws when no API key is provided', () => {
    const prev = process.env['ANTHROPIC_API_KEY'];
    delete process.env['ANTHROPIC_API_KEY'];
    expect(() => new ClaudeAdapter()).toThrow(/ANTHROPIC_API_KEY/);
    if (prev !== undefined) process.env['ANTHROPIC_API_KEY'] = prev;
  });

  it('POSTs to the Anthropic Messages API with the right headers', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 'msg_1',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'hi back' }],
        model: 'claude-sonnet-4-6',
        usage: { input_tokens: 5, output_tokens: 3 },
      }),
    } as Response);
    globalThis.fetch = fetchMock;

    const adapter = new ClaudeAdapter('test-key');
    const result = await adapter.generate('claude-sonnet-4-6', {
      taskType: 'hierarchy-decomposition',
      prompt: 'hi',
      maxTokens: 100,
    });

    expect(result.provider).toBe('claude');
    expect(result.response).toBe('hi back');
    expect(result.usage?.totalTokens).toBe(8);

    const [, init] = fetchMock.mock.calls[0]!;
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers['x-api-key']).toBe('test-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
  });

  it('throws on non-OK Claude API response', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      text: async () => 'rate limited',
    } as Response);
    const adapter = new ClaudeAdapter('test-key');
    await expect(
      adapter.generate('claude-sonnet-4-6', {
        taskType: 'x',
        prompt: 'hi',
      }),
    ).rejects.toThrow(/Claude API error 429/);
  });
});
