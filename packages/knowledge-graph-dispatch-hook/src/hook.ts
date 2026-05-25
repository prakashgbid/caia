/**
 * @caia/knowledge-graph-dispatch-hook — pre-dispatch hook (HOF).
 *
 * Mirrors the wrapper pattern in `@chiefaia/llm-cache`'s `withCache` and
 * the dispatch-hook pattern in `@caia/policy-linter` (the validating
 * Layer 1 hook). Together with policy-linter, this composes the full
 * preflight: Layer 3 (this, mutating: enriches brief) → Layer 2 (EA
 * Architect, mutating: rewrites plan) → Layer 1 (policy-linter,
 * validating: refuses on hard-fail).
 *
 * Usage:
 *
 *   import { createEventBus } from '@chiefaia/events';
 *   import { createKgDispatchHook } from '@caia/knowledge-graph-dispatch-hook';
 *
 *   const bus = createEventBus();
 *   const hook = createKgDispatchHook({ db, embedder, eventBus: bus });
 *
 *   const wrappedDispatch = hook(async (brief) => {
 *     return await myInnerDispatch(brief);
 *   });
 *
 *   // brief.briefMd now arrives at myInnerDispatch with AKG context
 *   // prepended; the original is preserved on a wrapper.
 *   const result = await wrappedDispatch(brief);
 *
 * Soft-fail discipline: if injectContext itself throws (it shouldn't,
 * but defensive), the hook still calls the inner dispatch with the
 * UNMODIFIED brief and annotates `fallbackUsed: 'embedder-down'`. The
 * spec is explicit (line 282): "package degrades to a no-op gracefully —
 * never throws, never blocks the wrapped dispatch."
 */

import type Database from 'better-sqlite3';
import type { EmbeddingClient } from '@chiefaia/architecture-registry';
import type { EventBus } from '@chiefaia/events';

import { injectContext } from './api.js';
import {
  CONTEXT_INJECTED,
  type ContextInjectedEvent,
  type DispatchBrief,
  type EnrichedBrief,
  type KgInjectionOpts,
  type KgInjectionStats,
} from './types.js';

/**
 * An inner dispatch function the hook wraps. Generic over the result
 * type so callers can return anything (ReviewOutcome, ChainResult, etc).
 *
 * The brief passed in is the ENRICHED brief — `brief.briefMd` is the
 * preamble + original. Callers who want the original can read it from
 * `brief.metadata?.originalBriefMd` (the hook stashes it there).
 */
export type DispatchFn<R> = (
  brief: DispatchBrief,
  enrichment: EnrichedBrief,
) => Promise<R> | R;

export interface KgDispatchHookDeps {
  db: Database.Database;
  embedder: EmbeddingClient;
  /** Optional event bus for `context.injected` emissions. */
  eventBus?: EventBus;
}

export interface KgDispatchHookOpts extends KgInjectionOpts {
  /**
   * Per-dispatch observer fired with the retrieval stats. Useful for
   * logging / metrics without subscribing to the event bus.
   */
  onInjected?: (event: ContextInjectedEvent) => void;
}

/**
 * Factory that returns a HOF wrapper. The factory binds the
 * (db, embedder, eventBus) once; the returned wrapper can be applied
 * to many different inner dispatch functions.
 */
export function createKgDispatchHook(
  deps: KgDispatchHookDeps,
  defaultOpts: KgDispatchHookOpts = {},
): <R>(inner: DispatchFn<R>, overrideOpts?: KgDispatchHookOpts) => (
  brief: DispatchBrief,
) => Promise<R> {
  return function withKgContext<R>(
    inner: DispatchFn<R>,
    overrideOpts: KgDispatchHookOpts = {},
  ): (brief: DispatchBrief) => Promise<R> {
    const opts: KgDispatchHookOpts = { ...defaultOpts, ...overrideOpts };
    return async function wrappedDispatch(brief: DispatchBrief): Promise<R> {
      const enriched = await safeInject(brief, deps, opts);
      await emitContextInjected(deps.eventBus, brief, enriched, opts);
      const enrichedBrief = enrichedDispatchBrief(brief, enriched);
      return await inner(enrichedBrief, enriched);
    };
  };
}

/**
 * Convenience standalone wrapper for one-shot callers that don't want
 * to keep a factory handle. Equivalent to
 * `createKgDispatchHook(deps, opts)(inner)`.
 */
export function withKgContext<R>(
  deps: KgDispatchHookDeps,
  inner: DispatchFn<R>,
  opts: KgDispatchHookOpts = {},
): (brief: DispatchBrief) => Promise<R> {
  return createKgDispatchHook(deps, opts)(inner);
}

/**
 * Run `injectContext` with belt-and-suspenders error handling. The api
 * layer already swallows expected errors, but this is the last line of
 * defence — a programmer error in retrieval must not block the
 * downstream dispatch.
 */
async function safeInject(
  brief: DispatchBrief,
  deps: KgDispatchHookDeps,
  opts: KgInjectionOpts,
): Promise<EnrichedBrief> {
  const t0 = Date.now();
  try {
    return await injectContext(brief, deps, opts);
  } catch (err) {
    void err;
    const stats: KgInjectionStats = {
      topK: opts.topK ?? 0,
      threshold: opts.threshold ?? 0.6,
      embedderTokens: 0,
      latencyMs: Date.now() - t0,
      retrievedCount: 0,
      sourcesByKind: {
        adr: 0,
        principle: 0,
        lesson: 0,
        feedback: 0,
        other: 0,
      },
      fallbackUsed: 'embedder-down',
    };
    return {
      brief: brief.briefMd,
      preamble: '',
      retrieved: [],
      stats,
      callerAgentId: brief.callerAgentId,
    };
  }
}

/**
 * Build the brief object the inner dispatch sees. The enriched briefMd
 * replaces the original; the original is stashed in `metadata` under
 * a non-clobbering key so callers that want both can recover.
 */
function enrichedDispatchBrief(
  brief: DispatchBrief,
  enriched: EnrichedBrief,
): DispatchBrief {
  const next: DispatchBrief = {
    callerAgentId: brief.callerAgentId,
    briefMd: enriched.brief,
    intent: brief.intent,
    metadata: {
      ...(brief.metadata ?? {}),
      kgDispatchHook: {
        originalBriefMd: brief.briefMd,
        retrievedCount: enriched.retrieved.length,
        fallbackUsed: enriched.stats.fallbackUsed,
      },
    },
  };
  if (brief.targetRepos !== undefined) next.targetRepos = brief.targetRepos;
  if (brief.briefSummary !== undefined) next.briefSummary = brief.briefSummary;
  return next;
}

/**
 * Fire the `context.injected` event on the bus (if wired) and also
 * call the per-dispatch `onInjected` callback (if supplied). Both run
 * fire-and-forget but the event-bus call is awaited so callers can
 * synchronously observe in tests.
 */
async function emitContextInjected(
  bus: EventBus | undefined,
  brief: DispatchBrief,
  enriched: EnrichedBrief,
  opts: KgDispatchHookOpts,
): Promise<void> {
  const event: ContextInjectedEvent = {
    callerAgentId: brief.callerAgentId,
    intent: brief.intent,
    stats: enriched.stats,
    retrievedIds: enriched.retrieved.map((a) => a.id),
  };
  if (bus) {
    try {
      await bus.emit<ContextInjectedEvent>(CONTEXT_INJECTED, event);
    } catch (err) {
      // Bus failure must not break the dispatch.
      void err;
    }
  }
  if (opts.onInjected) {
    try {
      opts.onInjected(event);
    } catch (err) {
      void err;
    }
  }
}
