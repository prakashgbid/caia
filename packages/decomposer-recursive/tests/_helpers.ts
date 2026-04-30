/**
 * Test helpers for @chiefaia/decomposer-recursive.
 *
 * These wrap the local-llm-router's `__setAdapters` test seam so tests
 * can drive deterministic LLM responses without booting Ollama or
 * reaching out to Claude.
 */

import { vi } from 'vitest';
import {
  __setAdapters,
  type LLMResponse,
  OllamaAdapter,
  ClaudeAdapter,
} from '@chiefaia/local-llm-router';

export interface FakeAdapterConfig {
  /** Sequence of responses to return on successive `generate` calls. */
  responses: Array<Partial<LLMResponse> & { response: string }>;
  /** Whether the local adapter advertises itself as available. Default true. */
  available?: boolean;
  /** When set, the adapter throws this error instead of returning. */
  throws?: Error;
}

/**
 * Create an Ollama-style fake. Returns the responses in order; if the
 * caller exceeds the queue, the LAST response is repeated.
 */
export function fakeOllama(config: FakeAdapterConfig): OllamaAdapter {
  let cursor = 0;
  return {
    isAvailable: vi.fn(async () => config.available ?? true),
    generate: vi.fn(async (model: string): Promise<LLMResponse> => {
      if (config.throws) throw config.throws;
      const idx = Math.min(cursor, config.responses.length - 1);
      cursor++;
      const next = config.responses[idx];
      if (!next) throw new Error('fakeOllama: no responses configured');
      return {
        response: next.response,
        model: next.model ?? model,
        provider: next.provider ?? 'local',
        durationMs: next.durationMs ?? 12,
        ...(next.usage ? { usage: next.usage } : {}),
      };
    }),
  } as unknown as OllamaAdapter;
}

/**
 * Create a Claude-style fake. Same semantics as fakeOllama.
 */
export function fakeClaude(config: FakeAdapterConfig): ClaudeAdapter {
  let cursor = 0;
  return {
    generate: vi.fn(async (model: string): Promise<LLMResponse> => {
      if (config.throws) throw config.throws;
      const idx = Math.min(cursor, config.responses.length - 1);
      cursor++;
      const next = config.responses[idx];
      if (!next) throw new Error('fakeClaude: no responses configured');
      return {
        response: next.response,
        model: next.model ?? model,
        provider: next.provider ?? 'claude',
        durationMs: next.durationMs ?? 800,
        ...(next.usage ? { usage: next.usage } : {}),
      };
    }),
  } as unknown as ClaudeAdapter;
}

/**
 * Wire fake adapters into the router for the duration of a single test.
 * The caller MUST clear them in `afterEach` via `clearAdapters()`.
 */
export function installFakeAdapters(
  ollama: OllamaAdapter,
  claude: ClaudeAdapter,
): void {
  __setAdapters(ollama, claude);
}

export function clearAdapters(): void {
  __setAdapters(null, null);
}

/**
 * Helper that builds a fake response with the supplied JSON payload
 * already serialised. Keeps the test bodies readable.
 */
export function jsonResponse(
  obj: unknown,
  overrides: Partial<LLMResponse> = {},
): Partial<LLMResponse> & { response: string } {
  const body = JSON.stringify(obj);
  return {
    response: body,
    durationMs: 25,
    ...overrides,
  };
}

/**
 * Helper for asserting that the parse-failure feedback loop is being
 * triggered. The first response is intentionally malformed so the
 * router will retry.
 */
export function malformedResponse(
  text = 'sorry I do not return JSON',
  overrides: Partial<LLMResponse> = {},
): Partial<LLMResponse> & { response: string } {
  return {
    response: text,
    durationMs: 25,
    ...overrides,
  };
}
