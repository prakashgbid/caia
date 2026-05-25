/**
 * @caia/knowledge-graph-dispatch-hook — public surface.
 *
 * Layer 3 of the AI-First Continuous-Discipline framework
 * (`research/ai_first_continuous_discipline_2026.md`).
 *
 * What it does
 * ------------
 *
 * Activates the already-built Architecture Knowledge Graph
 * (`@chiefaia/architecture-registry`, nomic-embed-text + sqlite-vec)
 * for pre-dispatch context injection. Every fresh subagent dispatch
 * receives the most-relevant ADRs / principles / lessons / feedback
 * memories auto-prepended to its brief based on semantic similarity to
 * the task topic.
 *
 * Mirrors the dispatch-hook pattern in `@caia/policy-linter`
 * (Layer 1, validating) and the HOF wrapper pattern in
 * `@chiefaia/llm-cache`'s `withCache`. Together the three compose the
 * full preflight: Layer 3 (mutate, enrich) → Layer 2 (EA Architect,
 * mutate, rewrite) → Layer 1 (policy-linter, validate, refuse).
 *
 * Public exports
 * --------------
 *
 *   - `injectContext(brief, deps, opts?)` — pure function, returns
 *     `EnrichedBrief`.
 *   - `createKgDispatchHook(deps, opts?)` — HOF factory.
 *   - `withKgContext(deps, inner, opts?)` — one-shot wrapper.
 *   - `buildPreamble(artifacts)` — direct access to the renderer.
 *   - `retrieveContext(query, deps, opts?)` — direct access to the
 *     embedder + kind-mix allocator.
 *   - Types: `DispatchBrief`, `EnrichedBrief`, `KgInjectionOpts`,
 *     `KgInjectionStats`, `RetrievedArtifact`, `KindMix`,
 *     `ContextInjectedEvent`, `DispatchIntent`.
 *   - Events: `CONTEXT_INJECTED` event-type constant.
 */

export {
  injectContext,
  deriveQuery,
  type InjectContextDeps,
} from './api.js';

export {
  createKgDispatchHook,
  withKgContext,
  type DispatchFn,
  type KgDispatchHookDeps,
  type KgDispatchHookOpts,
} from './hook.js';

export {
  retrieveContext,
  mergeKindMix,
  sumMix,
  allocateByKindMix,
  normaliseHit,
  deriveId,
  deriveDate,
  DEFAULT_KIND_MIX,
  type RetrieveDeps,
  type RetrieveOpts,
  type RetrieveResult,
} from './embedder.js';

export {
  buildPreamble,
  prependPreamble,
  groupByKind,
  renderArtifactLine,
  PREAMBLE_HEADER,
  PREAMBLE_INTRO,
} from './context-builder.js';

export {
  CONTEXT_INJECTED,
  type ContextInjectedEvent,
  type DispatchBrief,
  type DispatchIntent,
  type EnrichedBrief,
  type KgInjectionOpts,
  type KgInjectionStats,
  type RetrievedArtifact,
  type KindMix,
} from './types.js';
