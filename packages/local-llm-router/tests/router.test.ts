import { describe, it, expect, beforeEach, vi } from 'vitest';
import { route, __setAdapters } from '../src/router.js';
import type { OllamaAdapter } from '../src/ollama-adapter.js';
import type { ClaudeAdapter } from '../src/claude-adapter.js';
import type { LLMResponse } from '../src/types.js';
import { llmMetrics } from '../src/llm-metrics.js';

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

// A.9.1.1 — assert llmMetrics.record() actually fires from the router
// decision points (was dead code prior to this fix).
describe('route — llmMetrics wiring (A.9.1.1)', () => {
  beforeEach(() => {
    __setAdapters(null, null);
    llmMetrics.reset();
  });

  it('records a local dispatch into llmMetrics', async () => {
    __setAdapters(fakeOllama(), fakeClaude());
    await route('domain-classification', 'classify this');
    const snap = llmMetrics.snapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.localCalls).toBe(1);
    expect(snap.claudeCalls).toBe(0);
    expect(snap.perTask[0]?.taskType).toBe('domain-classification');
  });

  it('records a claude dispatch into llmMetrics', async () => {
    __setAdapters(fakeOllama(), fakeClaude());
    await route('hierarchy-decomposition', 'decompose this');
    const snap = llmMetrics.snapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.claudeCalls).toBe(1);
    expect(snap.localCalls).toBe(0);
  });

  it('records a cache hit (no provider dispatch)', async () => {
    const ollama = fakeOllama();
    const claude = fakeClaude();
    __setAdapters(ollama, claude);
    const cachedResponse: LLMResponse = {
      response: 'cached',
      model: 'qwen2.5-coder:7b',
      provider: 'local',
      durationMs: 1,
    };
    await route('domain-classification', 'classify this', {
      cacheLookup: () => cachedResponse,
    });
    const snap = llmMetrics.snapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.cacheHits).toBe(1);
    expect(ollama.generate).not.toHaveBeenCalled();
    expect(claude.generate).not.toHaveBeenCalled();
  });

  it('records a fallback as a single call with the FINAL provider', async () => {
    const ollama = fakeOllama();
    const claude = fakeClaude({ throws: new Error('rate limit') });
    __setAdapters(ollama, claude);
    await route('hierarchy-decomposition', 'decompose this');
    const snap = llmMetrics.snapshot();
    expect(snap.totalCalls).toBe(1);
    // fell back to local, so the recorded provider is local.
    expect(snap.localCalls).toBe(1);
    expect(snap.claudeCalls).toBe(0);
  });

  it('records cost columns using the routing rule', async () => {
    __setAdapters(fakeOllama(), fakeClaude());
    // Use a task with a baseline ≥ 4-decimal-precision (round4 in
    // llm-metrics rounds the snapshot to tenths-of-a-cent, so we pick
    // a baseline > $0.0001/call).
    await route('hierarchy-decomposition', 'decompose this', {
      forceLocal: true,
    });
    const snap = llmMetrics.snapshot();
    // hierarchy-decomposition Claude baseline = $2.00 per 1000 calls = $0.002
    expect(snap.baselineCostUsd).toBeCloseTo(0.002, 4);
    expect(snap.estimatedCostUsd).toBe(0);
    expect(snap.savedUsd).toBeGreaterThan(0);
  });
});
