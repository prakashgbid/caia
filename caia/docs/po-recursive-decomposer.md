# `@chiefaia/decomposer-recursive` — Operator Runbook

**Status:** P0 shipped (PRs #213–#217 on the `PO-DECOMP-###` track).
**Audience:** Anyone debugging the recursive decomposer, calibrating its prompts, or extending it for P1.
**Source proposal:** [`reports/po-decomposition-architecture-proposal-2026-04-29.md`](../../reports/po-decomposition-architecture-proposal-2026-04-29.md).

## What this package is

The `@chiefaia/decomposer-recursive` package replaces the single-shot Claude path in `@chiefaia/decomposer` for vision-document-scale prompts. It implements the recursive-decomposition design from the proposal:

- **Adaptive scope detector** classifies a prompt's natural scope (initiative | epic | module | story | task | subtask) so the engine doesn't manufacture fake five-level hierarchies for one-line asks.
- **Recursive decomposer engine** (`PORecursiveDecomposer`) walks down from the natural scope to the atomicity floor, expanding one parent at a time via scope-specialised prompts.
- **Atomicity classifier** (per-scope INVEST/SAFe/DDD rubric) decides leaves vs. continued recursion.
- **MECE judge pair** (parent-coverage + sibling-disjointness) runs after every expansion in parallel via `Promise.all`. Each judge produces a 1–5 score; threshold 4.0/5 → reflexive retry on fail (max 2).

## How it works (one-paragraph mental model)

A prompt comes in. The scope detector decides where the recursion should *start* (e.g., "add a logout button" → start at `story`; vision document → start at `initiative`). The engine then walks down the scope hierarchy: at each parent, it queries the FREG/AKG substrate (P0 stub returns empty), runs the per-scope decomposer prompt to produce candidate children, runs both MECE judges in parallel, and on fail injects the judges' feedback back into the next decomposer attempt as a Reflexion-style system message. Each child runs through the atomicity classifier; atomic children become leaves, non-atomic ones are enqueued for one-scope-deeper expansion. Recursion bottoms out when every leaf passes its scope's atomicity criterion, or when the cost guard fires.

## Installing / depending

```jsonc
// package.json (your consumer)
{
  "dependencies": {
    "@chiefaia/decomposer-recursive": "workspace:*"
  }
}
```

The package re-exports `StoryScope`, `STORY_SCOPES`, `STORY_SCOPE_ORDER`, `isStoryScope` from `@chiefaia/ticket-template` so consumers don't need to import both.

## Quick start (programmatic)

```ts
import {
  detectScope,
  PORecursiveDecomposer,
  runJudgePair,
} from '@chiefaia/decomposer-recursive';

// 1) Classify the natural scope of the prompt.
const scope = await detectScope({
  promptText: 'Build a poker analytics SaaS — web + mobile + Stripe + Discord.',
});
// → { targetScope: 'initiative', confidence: 0.86, rationale: '...', model: '...', durationMs: ... }

// 2) Drive the engine.
const engine = new PORecursiveDecomposer();
const result = await engine.decomposeRoot({
  parent: {
    id: 'root',
    scope: scope.targetScope,
    title: 'Poker analytics SaaS',
    description: 'Web + mobile + Stripe + Discord',
    inScope: ['web app', 'mobile app', 'billing', 'community integration'],
    outOfScope: [],
  },
  targetScope: 'subtask', // walk all the way to subtask atomicity
  maxExpansions: 200,     // cost guard
});

// result.tree is the full DecomposedTreeNode with .children recursively populated.
// result.audits has one AuditEntry per expansion.
// result.totalCostUsd is the cumulative spend.

// 3) Optionally judge an expansion (the engine doesn't auto-call judges in P0; PR 4 wires this in).
const judgeVerdict = await runJudgePair({
  parent: { /* parent-shape */ },
  children: [/* the children produced */],
});
// → { coverage, disjointness, bothPassed, reflexiveFeedback }
```

## Routing-rule task types

The package adds 10 routing rules to `@chiefaia/local-llm-router`. All but the four "high-stakes" rules (initiative + epic + the two judges) default to local Ollama with Claude fallback.

| Task type                                  | Default provider  | Local model         | Claude model              | Description                                  |
|--------------------------------------------|-------------------|---------------------|---------------------------|----------------------------------------------|
| `po-decomposer-scope-detection`            | local (Ollama)    | qwen2.5-coder:7b    | claude-haiku-4-5-20251001 | Adaptive natural-scope classifier.           |
| `po-decomposer-atomicity-classification`   | local (Ollama)    | qwen2.5-coder:7b    | claude-haiku-4-5-20251001 | Per-scope INVEST/SAFe/DDD rubric.            |
| `po-decomposer-initiative`                 | Claude (Sonnet)   | qwen3:14b           | claude-sonnet-4-6         | Initiative → epic decomposer.                |
| `po-decomposer-epic`                       | Claude (Sonnet)   | qwen3:14b           | claude-sonnet-4-6         | Epic → module decomposer.                    |
| `po-decomposer-module`                     | local (Ollama)    | qwen3:14b           | claude-sonnet-4-6         | Module → story decomposer (LAI-005 default). |
| `po-decomposer-story`                      | local (Ollama)    | qwen2.5-coder:14b   | claude-sonnet-4-6         | Story → task decomposer (LAI-005 default).   |
| `po-decomposer-task`                       | local (Ollama)    | qwen2.5-coder:14b   | claude-sonnet-4-6         | Task → subtask decomposer.                   |
| `po-decomposer-subtask`                    | local (Ollama)    | qwen2.5-coder:7b    | claude-haiku-4-5-20251001 | Subtask → mechanical step (rare).            |
| `po-decomposer-coverage-judge`             | Claude (Sonnet)   | qwen3:14b           | claude-sonnet-4-6         | PMBOK 100% rule judge.                       |
| `po-decomposer-disjointness-judge`         | Claude (Sonnet)   | qwen3:14b           | claude-sonnet-4-6         | MECE-mutually-exclusive judge.               |

## Adding a new scope

1. Update `STORY_SCOPES` in `@chiefaia/ticket-template/src/section-contract.ts`. Add the new scope to the canonical array, the `STORY_SCOPE_ORDER` map, and the `DEFAULT_STORY_SCOPE` if appropriate.
2. Update `ATOMICITY_RUBRICS` in `packages/decomposer-recursive/src/atomicity-classifier.ts` with a new rubric. Each rubric item must be ≥ 10 chars and verbatim-quotable (the LLM returns failed criteria as verbatim strings).
3. Add a system prompt for the new scope to `DECOMPOSER_SYSTEM_PROMPTS` in `per-scope-prompts.ts`.
4. Add the new scope to `DECOMPOSER_TASK_TYPES` and add the corresponding routing-rule task type to `@chiefaia/local-llm-router/routing-config.ts`. Pick the right model tier for the scope (high-stakes scopes default Claude; deep-recursion scopes default local).
5. Update `CHILD_SCOPE_OF` to map the new scope to its child (or `null` if it's the new floor).

## How to debug judge failures

When `runJudgePair` returns `bothPassed: false`, the engine (PR 4) injects `result.reflexiveFeedback` as a Reflexion-style system message on the next decomposer retry. To debug an end-to-end stuck branch:

1. **Read the verdict.** `coverage.passed` vs `disjointness.passed` tells you which judge fired. The verdict's `rationale` field has the model's free-form explanation.
2. **Look at the missing/overlap lists.** `coverage.missingDeliverables[]` is verbatim-extracted from the parent's `inScope`. If the list is empty but `passed: false`, the model invoked the force-correction path — re-read the rationale, the model probably scored low without giving you a structured reason.
3. **Inspect the audit row.** `audit.attempt > 1` means the parent was already retrying when the judges fired. After 3 attempts the engine escalates to a `decomposition-stuck` blocker (PR 4 wires the blocker emission).
4. **Replay locally.** The validation suite's stub mode lets you reproduce a failure with deterministic fakes:
   ```bash
   pnpm --filter @chiefaia/decomposer-recursive test -t "judge"
   ```
5. **Calibrate against ground truth.** If the same failure mode keeps surfacing across prompts, the judge prompt is mis-specified. The proposal §11 R1 mitigation (ensemble + position-swap + cross-model judging) is the next P1 lever.

## How to interpret cost telemetry

Every `decomposeRoot` call returns `{ totalCostUsd, totalDurationMs, totalCalls, audits[] }`. The cost is the *Claude* cost only — local Ollama calls are $0.00. Per-call cost is read from each routing rule's `estimatedCostClaude` string ("$X per 1000 calls") and divided by 1000. This is *upper-bound*: it does not account for actual token counts, only the rule's quoted average.

The proposal §10 cost model targets:

| Prompt class                | Nodes (typical) | Claude cost (post-optimisation) | Wall-clock | Default cost-guard budget |
|-----------------------------|-----------------|---------------------------------|------------|---------------------------|
| Tiny (story-natural)        | 1               | $0.01–0.05                      | 3–5s       | $1                        |
| Small (epic-natural)        | 5–20            | $1–3                            | 30–60s     | $5                        |
| Medium (initiative-natural) | 50–200          | $5–10                           | 3–6m       | $25                       |
| Large (vision-doc)          | 300–700         | $20–40                          | 15–25m     | $50 (Prakash-approved)    |

If `truncated: true` is returned, the engine hit `maxExpansions` and stopped early — the partial tree is in `result.tree`. Increase `maxExpansions` and re-run, or partition the prompt into smaller sub-prompts per the proposal §5C.5 multi-sub-project trigger.

## Running the validation suite

Two modes:

**Stub mode** (default; runs in CI on every PR):

```bash
pnpm --filter @chiefaia/decomposer-recursive test
```

84 vitest cases. No LLM dependencies; fully deterministic.

**Live mode** (operator-only — requires Ollama running locally):

```bash
DECOMPOSER_VALIDATION_LIVE=1 pnpm --filter @chiefaia/decomposer-recursive test \
  -- tests/diverse-prompts-validation.test.ts -t "real-LLM"
```

Drives the 10 PHASE2E-002 prompts through the real `local-llm-router` scope detector. Output is logged per prompt:

```
[validation/simple-feature] scope=story confidence=0.90 model=qwen2.5-coder:7b duration=10043ms
```

The most-recent live-mode results are captured in [`po-decomposer-validation-2026-04-30.md`](./po-decomposer-validation-2026-04-30.md).

## P1 work list (deferred from P0)

These are explicitly out of P0 scope per the proposal §11 phasing. Pick them up in any order; each is a single-PR effort modeled on the P0 PR shape.

1. **Pipeline integration** — wire the recursive decomposer into `apps/orchestrator/src/agents/po-agent.ts` behind `PO_USE_RECURSIVE_DECOMPOSER`. Default off; flip after 30 production decompositions show parity with the legacy single-shot path. (PR 4 in the P0 series is the placeholder; ship as P1-001.)
2. **Real FREG / AKG wiring** — replace `querySubstrateStub` with calls to `searchAndLog` (FREG) and `archSearch` (AKG). The prompt envelope already has the slots.
3. **Clarifying-question pipeline** — implement the 3-sample disagreement detector + question generator. Branch into `awaiting-clarification` state; surface to the dashboard.
4. **Vision-document chunker** — chunk by markdown headings + paragraph boundaries; per-chunk theme extraction via Ollama; deduplicate via embedding cosine; feed deduplicated themes into the initiative-decomposer prompt.
5. **Ollama `keep_alive`** — keep the scope-detection + atomicity-classification models hot on the orchestrator process. Drops scope-detection latency from ~3s to ~1s.
6. **Judge calibration** — sample 30 real expansions; score the judges against human verdicts; tune the prompts and the 4.0/5 threshold accordingly.
7. **Decomposition audit table + dashboard** — add `decomposition_audit` table per proposal §5G; wire the dashboard `/decomposition/[promptId]` page.

## Sources

- Proposal: [`reports/po-decomposition-architecture-proposal-2026-04-29.md`](../../reports/po-decomposition-architecture-proposal-2026-04-29.md)
- Validation report: [`po-decomposer-validation-2026-04-30.md`](./po-decomposer-validation-2026-04-30.md)
- Existing PO Agent: `apps/orchestrator/src/agents/po-agent.ts`
- Legacy decomposer (kept behind feature flag for one cycle): `packages/decomposer/src/claude-decomposer.ts`
