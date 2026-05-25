# @caia/knowledge-graph-dispatch-hook

**Layer 3** of the AI-First Continuous-Discipline framework
(`research/ai_first_continuous_discipline_2026.md`).

Activates the already-built but underused Architecture Knowledge Graph
(`@chiefaia/architecture-registry` — nomic-embed-text + sqlite-vec) for
**pre-dispatch context injection**. Every fresh subagent dispatch gets the
most-relevant ADRs / principles / lessons / feedback memories
auto-prepended to its brief based on semantic similarity to the task
topic.

## Where it sits

Mirrors the higher-order dispatch-wrapper pattern in `@caia/policy-linter`
(Layer 1, validating) and `@chiefaia/llm-cache`'s `withCache` (HOF
wrapper around route-style functions). Together they compose the
preflight in spec order:

```
brief → Layer 3 (this)  → Layer 2 (EA Architect)  → Layer 1 (policy-linter) → spawn
        mutate, enrich    mutate, rewrite plan      validate, refuse
```

## Quick start

```ts
import { createKgDispatchHook } from '@caia/knowledge-graph-dispatch-hook';
import { createEventBus } from '@chiefaia/events';
import {
  bootstrapVectorTables,
  OllamaEmbeddingClient,
} from '@chiefaia/architecture-registry';
import Database from 'better-sqlite3';
import { homedir } from 'node:os';
import { join } from 'node:path';

const db = new Database(join(homedir(), '.caia/akg.sqlite'));
bootstrapVectorTables(db);
const embedder = new OllamaEmbeddingClient({ model: 'nomic-embed-text' });
const eventBus = createEventBus();

const hook = createKgDispatchHook({ db, embedder, eventBus });

const wrappedDispatch = hook(async (brief) => {
  // brief.briefMd now arrives with the "Architecture Context" preamble
  // prepended. Your inner dispatch sees the enriched brief.
  return await myInnerDispatch(brief);
});

const result = await wrappedDispatch({
  callerAgentId: 'researcher-001',
  briefMd: 'Investigate event-sourcing options for the leaderboard...',
  intent: 'research',
});
```

## The preamble shape (verbatim from spec lines 651-672)

```markdown
## Architecture Context (auto-injected by AKG)

The following decisions, principles, and lessons may be relevant to this
task. Read them before proceeding. If any seem to constrain the requested
action, surface that to the caller via your output.

### ADRs
- [ADR-011] Event-first state with database as projection
- [ADR-028] Architecture Knowledge Graph via sqlite-vec + nomic-embed
- [ADR-038] EA Reviewer vs EA Architect scope

### Principles
- [P3] No timelines, ever

### Lessons
- [L01] Pixel-perfect calibration (85%/95% diff thresholds)

### Recent feedback memories
- [feedback-continuous-discipline-problem] (2026-05-24)
```

Empty sections are omitted. When every section is empty, the preamble is
the empty string and the original brief passes through unchanged.

## API

### `injectContext(brief, deps, opts?) → EnrichedBrief`

Pure function. Returns `{ brief, preamble, retrieved, stats,
callerAgentId }`. Never throws — failures fall through to a no-op with
`stats.fallbackUsed` set to one of `'disabled' | 'embedder-down' |
'sparse-only' | 'empty-kg' | 'none'`.

### `createKgDispatchHook(deps, opts?) → withKgContext`

Factory returning the HOF wrapper. Bind the deps once, wrap many
dispatch fns.

### `withKgContext(deps, inner, opts?) → wrappedDispatch`

One-shot convenience for callers that don't need a factory handle.

### Knobs (`KgInjectionOpts`)

- `topK` — total hits surfaced (default sum of kindMix = 6)
- `threshold` — sqlite-vec cosine floor (default 0.6, spec line 676)
- `kindMix` — per-kind slot allocation; underflow rolls forward
  (default `{adr:3, principle:1, lesson:1, feedback:1, other:0}`)
- `disabled` — when true the hook is a no-op (default false)
- `sparseOnly` / `denseOnly` — pin one retriever
- `queryOverride` — override the embedding-query text
- `briefSummaryMaxChars` — cap for auto-derived query string (default 1200)
- `preambleOnly` — return preamble but DON'T mutate `brief`

## Failure modes

Per the spec (lines 282-285), this package degrades to a no-op
gracefully — never throws, never blocks the wrapped dispatch.

- **Empty AKG** (T06 not yet run): `fallbackUsed: 'empty-kg'`. Preamble
  is empty. Brief passes through.
- **Ollama down / model not pulled**: caught at the embedder layer →
  retries sparse-only. `fallbackUsed: 'sparse-only'`.
- **DB error / corrupt index**: caught at the hook layer.
  `fallbackUsed: 'embedder-down'`. Brief passes through unchanged.
- **Caller-requested disable**: `opts.disabled === true` →
  `fallbackUsed: 'disabled'`. Instant return.

## Cost discipline

Zero outbound network. All retrieval + embedding is local
(Ollama + sqlite). Aligns with P1 (subscription-only) and P14
(no-paid-API per ADR-001).

## Forward compatibility note (spec task T06)

The AKG schema today exposes `ArtifactKind = 'adr' | ...` but not yet
`'principle' | 'lesson' | 'feedback'`. Until T06 lands first-class
kinds, principle/lesson/feedback rows are indexed as `kind='adr'` with
a discriminating `tags[]` entry — this package recognises both shapes
in `embedder.normaliseHit()` so the preamble renders correctly today
AND after T06 with no code change.
