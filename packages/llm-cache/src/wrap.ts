// Higher-order wrapper that turns a `(taskType, prompt) => CachedResponse`
// function (i.e. the @chiefaia/local-llm-router `route` signature) into one
// that consults the cache before each call.
//
// Why a wrapper and not a method on PromptCache itself? Keeps PromptCache
// reusable for non-router workloads (one-shot scripts, future agents) and
// keeps this package free of any dependency on the router.

import type { PromptCache } from './cache.js';
import type { CachedResponse } from './types.js';

export interface RouteFn<TOptions> {
  (taskType: string, prompt: string, options?: TOptions): Promise<CachedResponse>;
}

export interface WrapOptions {
  /**
   * Pull the model id off the response after a miss. Default takes
   * `result.model`; overrideable for adapters that name it differently.
   */
  getModel?: (response: CachedResponse) => string;
  /**
   * Optional callback fired on every lookup so callers can record metrics
   * (LAI-006 observability hooks here).
   */
  onResolve?: (event: ResolveEvent) => void;
}

export type ResolveEvent =
  | {
      kind: 'hit';
      hitKind: 'exact' | 'semantic';
      taskType: string;
      model: string;
      similarity: number;
      durationMs: number;
    }
  | {
      kind: 'miss';
      taskType: string;
      durationMs: number;
    };

/**
 * Wrap a router-style function with a two-tier cache. The returned
 * function has the same signature; on a hit it returns the cached
 * value (with its original `model` and `provider`); on a miss it calls
 * the underlying router and caches the result.
 */
export function withCache<TOptions>(
  cache: PromptCache,
  inner: RouteFn<TOptions>,
  modelByTaskType: (taskType: string) => string,
  options: WrapOptions = {},
): RouteFn<TOptions> {
  const getModel = options.getModel ?? ((r: CachedResponse) => r.model);

  return async function cachedRoute(
    taskType: string,
    prompt: string,
    routeOptions?: TOptions,
  ): Promise<CachedResponse> {
    const start = Date.now();
    const model = modelByTaskType(taskType);
    const key = { namespace: taskType, model, prompt };

    const hit = await cache.lookup(key);
    if (hit) {
      options.onResolve?.({
        kind: 'hit',
        hitKind: hit.kind,
        taskType,
        model,
        similarity: hit.similarity,
        durationMs: Date.now() - start,
      });
      return hit.value;
    }

    const response = await inner(taskType, prompt, routeOptions);
    await cache.put(
      { namespace: taskType, model: getModel(response), prompt },
      response,
    );

    options.onResolve?.({
      kind: 'miss',
      taskType,
      durationMs: Date.now() - start,
    });

    return response;
  };
}
