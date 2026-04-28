import { describe, it, expect, beforeEach, vi } from 'vitest';
import { route, __setAdapters } from '../src/router.js';
import type { OllamaAdapter } from '../src/ollama-adapter.js';
import type { ClaudeAdapter } from '../src/claude-adapter.js';
import type { LLMResponse } from '../src/types.js';

function fakeOllama(opts: {
  available?: boolean;
  response?: Partial<LLMResponse>;
  throws?: Error;
} = {}): OllamaAdapter {
  const available = opts.available ?? true;
  const generateResponse: LLMResponse = {
    response: 'local response',
    model: 'qwen2.5-coder:7b',
    provider: 'local',
    durationMs: 42,
    ...opts.response,
  };
  return {
    isAvailable: vi.fn().mockResolvedValue(available),
    generate: vi.fn(async () => {
      if (opts.throws) throw opts.throws;
      return generateResponse;
    }),
  } as unknown as OllamaAdapter;
}

function fakeClaude(opts: {
  response?: Partial<LLMResponse>;
  throws?: Error;
} = {}): ClaudeAdapter {
  const generateResponse: LLMResponse = {
    response: 'claude response',
    model: 'claude-sonnet-4-6',
    provider: 'claude',
    durationMs: 1200,
    ...opts.response,
  };
  return {
    generate: vi.fn(async () => {
      if (opts.throws) throw opts.throws;
      return generateResponse;
    }),
  } as unknown as ClaudeAdapter;
}

describe('route', () => {
  beforeEach(() => {
    __setAdapters(null, null);
  });

  it('routes a "useLocal: true" task to Ollama', async () => {
    const ollama = fakeOllama();
    __setAdapters(ollama, fakeClaude());

    const res = await route('domain-classification', 'classify this');

    expect(res.provider).toBe('local');
    expect(ollama.generate).toHaveBeenCalledOnce();
  });

  it('routes a "useLocal: false" task to Claude', async () => {
    const claude = fakeClaude();
    __setAdapters(fakeOllama(), claude);

    const res = await route('hierarchy-decomposition', 'decompose this');

    expect(res.provider).toBe('claude');
    expect(claude.generate).toHaveBeenCalledOnce();
  });

  it('forceClaude overrides routing rule', async () => {
    const claude = fakeClaude();
    __setAdapters(fakeOllama(), claude);

    const res = await route('domain-classification', 'classify this', {
      forceClaude: true,
    });

    expect(res.provider).toBe('claude');
  });

  it('forceLocal overrides routing rule', async () => {
    const ollama = fakeOllama();
    __setAdapters(ollama, fakeClaude());

    const res = await route('hierarchy-decomposition', 'decompose this', {
      forceLocal: true,
    });

    expect(res.provider).toBe('local');
  });

  it('falls back to Claude when Ollama is unavailable', async () => {
    const ollama = fakeOllama({ available: false });
    const claude = fakeClaude();
    __setAdapters(ollama, claude);

    const res = await route('story-enrichment', 'enrich this');

    expect(res.provider).toBe('claude');
    expect(claude.generate).toHaveBeenCalledOnce();
  });

  it('falls back to local when Claude errors', async () => {
    const ollama = fakeOllama();
    const claude = fakeClaude({ throws: new Error('rate limit') });
    __setAdapters(ollama, claude);

    const res = await route('hierarchy-decomposition', 'decompose this');

    expect(res.provider).toBe('local');
  });

  it('throws when fallback disabled and primary fails', async () => {
    const ollama = fakeOllama({ available: false });
    __setAdapters(ollama, fakeClaude());

    await expect(
      route('story-enrichment', 'enrich this', { fallbackOnError: false }),
    ).rejects.toThrow();
  });
});
