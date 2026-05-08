/**
 * Test fixtures — mock LLM router for Stage A unit tests.
 *
 * Mimics the `route(taskType, prompt, options)` shape from
 * @chiefaia/local-llm-router. Tests configure a queue of canned responses;
 * the mock pops them in order.
 */

import type { LLMResponse, RouterOptions } from '@chiefaia/local-llm-router';

export interface MockRouterCall {
  taskType: string;
  prompt: string;
  options?: RouterOptions;
}

export interface MockRouter {
  route: (taskType: string, prompt: string, options?: RouterOptions) => Promise<LLMResponse>;
  calls: MockRouterCall[];
}

/**
 * Build a mock router. Each call pops the next response from the queue.
 *
 * Each queued entry can be:
 *   - a string  → wrapped into a default LLMResponse
 *   - an LLMResponse object → returned verbatim
 *   - an Error → thrown
 */
export function makeMockRouter(
  responses: Array<string | LLMResponse | Error>
): MockRouter {
  const queue = [...responses];
  const calls: MockRouterCall[] = [];

  const route = async (
    taskType: string,
    prompt: string,
    options?: RouterOptions
  ): Promise<LLMResponse> => {
    calls.push({ taskType, prompt, ...(options ? { options } : {}) });
    if (queue.length === 0) {
      throw new Error('makeMockRouter: queue empty — more calls than canned responses');
    }
    const next = queue.shift();
    if (next instanceof Error) throw next;
    if (typeof next === 'string') {
      return {
        response: next,
        model: 'mock-qwen',
        provider: 'local',
        durationMs: 1
      };
    }
    return next as LLMResponse;
  };

  return { route, calls };
}

/**
 * Helper for the common case: a single happy-path response with a
 * complete FormalDoc payload.
 */
export function happyDocResponse(extras: Record<string, unknown> = {}): string {
  return JSON.stringify({
    id: 'placeholder-id',
    name: 'Placeholder Page',
    audience: 'placeholder audience',
    brandVoice: 'placeholder voice',
    industry: 'saas',
    primaryCtas: ['Sign up'],
    sections: [
      { id: 'hero-1', section: 'HeroSection', intent: 'Hero copy', height: 480 },
      { id: 'features-2', section: 'FeatureGrid', intent: 'Three feature cards' }
    ],
    origin: 'llm',
    ...extras
  });
}
