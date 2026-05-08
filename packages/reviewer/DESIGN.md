# `@chiefaia/reviewer` — Design

**Status**: Tier-A item 9.5 of `agent_ecosystem_expansion_directive.md` — craftsmanship-focused PR review agent.
**Shape**: Option E (`agent_architecture_shape_2026-05-06.md`).
**Author**: 2026-05-06 (Reviewer-001 leg).
**Distinct from Critic (item 9, shipped as PR #379)**: Critic is ADVERSARIAL — finds what's wrong, blocks merges. Reviewer is CRAFTSMANSHIP — readability, idioms, maintainability, advisory-only.

## 1. Mandate

After Critic passes (no blocking findings), the Reviewer Agent reads the unified diff plus surrounding repo context and posts CRAFTSMANSHIP feedback as PR comments: naming clarity, function length, comment density, idiom adherence, abstraction quality, suggested refactors. Reviewer findings are **never blocking** — they are advisory suggestions the producing agent can adopt or defer at its discretion.

**Why this complements Critic** (operator-confirmed in directive): Critic + Reviewer cover the two halves of code review — Critic answers *"what could break this"* (security, regressions, taxonomy violations), Reviewer answers *"how could this be cleaner"* (idioms, readability, future-maintainer ergonomics). Industry SOTA (CodeRabbit, GitHub Copilot Code Review, Sourcery, Greptile) all converge on this split — block-worthy vs advisory.

**Why advisory-only**: a craftsmanship review that blocks merges trains agents to argue with style nits; one that comments and lets the author decide trains agents to absorb idioms over time. Mentor's clustering pipeline picks up recurring Reviewer suggestions and proposes them as Steward rules — that's how craftsmanship lessons graduate to enforcement, not by the Reviewer blocking on its own.

## 2. Package shape (Option E checklist)

- ✅ `packages/reviewer/` (NOT `apps/reviewer/`)
- ✅ `package.json`: `"private": true`, scope `@chiefaia/reviewer`, never published
- ✅ Public API parameterised via `ReviewerAgentConfig` constructor — every threshold / path / topic is a parameter with a CAIA default
- ✅ Tests inject fixture diffs at `tests/__fixtures__/diffs/` — never live CAIA paths
- ✅ Pre-spawn injection: when Reviewer dispatches its craftsmanship-review prompt to the `claude` binary, the prompt passes through `caia-mentor-prepend | caia-librarian-prepend` (orchestrator-side wiring)
- ✅ AGENTS.md is consulted for build/test/lint commands

## 3. Public API

```typescript
import { ReviewerAgent } from '@chiefaia/reviewer';

const reviewer = new ReviewerAgent({
  // All optional — CAIA defaults filled in by constructor.
  conventionsPath: '~/.../caia/AGENTS.md',
  memoryRoot:      '~/.../agent/memory',
  reportsRoot:     '~/Documents/projects/reports',
  eventBusUrl:     'tcp://localhost:7777',
  claudeBinaryPath: 'claude',
  modelTag:        'claude-haiku-4-5-20251001',
  // Behaviour knobs:
  maxDiffBytes:    256_000,
  chunkBytes:       64_000,
  // Severity floor — Reviewer's severity scale is suggestion / consider / nit / praise.
  severityFloor:   'nit',
  perVectorTimeoutMs: 60_000,
  maxFindingsPerPr: 30,         // industry sweet spot ~5-10; cap at 30 to avoid noise
  // Craftsmanship thresholds (deterministic tier):
  maxFunctionLines: 60,
  maxFileLines:     500,
  maxNestingDepth:  4,
  // Tier toggles:
  enableLlmReasoning: true,
  enableDeterministic: true,
  // Test seams (DI):
  fs:       defaultFsReader,
  llm:      createDefaultLlmReviewer(...),
  clock:    () => new Date(),
});

const review: CraftsmanshipReview = await reviewer.reviewPR({
  prNumber: 393,
  diff: '<unified diff text>',
  context: { branch: 'feat/reviewer-001-design', baseBranch: 'develop', title: '...' }
});
```

CLI surface:

```bash
caia-reviewer review --pr 393                      # use CAIA defaults
caia-reviewer review --pr 393 --diff-file ./pr.diff
caia-reviewer review --pr 393 --output json        # machine-readable
caia-reviewer review --pr 393 --severity-floor consider
caia-reviewer dry-run --diff-file ./pr.diff        # craftsmanship-review without writing PR comment
```

## 4. Output shape — `CraftsmanshipReview`

```typescript
interface CraftsmanshipReview {
  prNumber: number;
  reviewedAtIso: string;
  totalFindings: number;
  findings: CraftsmanshipFinding[];
  summary: {
    countBySeverity: Record<CraftsmanshipSeverity, number>;
    countByDimension: Partial<Record<CraftsmanshipDimensionId, number>>;
    chunksReviewed: number;
    durationMs: number;
    deterministic: number;
    llmReasoned: number;
    llmEnabled: boolean;
    llmReasoningSucceeded: boolean;
  };
  // Reviewer NEVER produces blocking findings — explicit absence.
  // Steward consumes Critic's blockingFindings; Reviewer's findings are FYI.
}

interface CraftsmanshipFinding {
  id: string;                                        // stable hash
  dimension: CraftsmanshipDimensionId;
  severity: CraftsmanshipSeverity;
  file: string;
  line: number;
  suggestionTitle: string;                           // human-readable e.g. 'extract-magic-number'
  description: string;                               // why this would be cleaner
  suggestedChange?: string;                          // concrete refactor sketch (optional)
  source: 'deterministic' | 'llm-reasoned';
  detectorId: string;
  excerpt: string;                                   // ≤200 chars of the diff line
}

type CraftsmanshipSeverity = 'nit' | 'suggestion' | 'consider' | 'praise';

type CraftsmanshipDimensionId =
  // Deterministic-tier dimensions (10):
  | 'naming-convention'
  | 'function-length'
  | 'file-length'
  | 'comment-density'
  | 'magic-numbers'
  | 'duplicate-imports'
  | 'deep-nesting'
  | 'todo-without-ticket'
  | 'console-logging'
  | 'type-any'
  // LLM-reasoned-tier dimensions (8):
  | 'idiom-adherence'
  | 'abstraction-quality'
  | 'suggested-refactor'
  | 'test-design'
  | 'error-handling-style'
  | 'architecture-pattern'
  | 'documentation-quality'
  | 'api-ergonomics';
```

The 18 dimensions are 1:1 disjoint from Critic's 18 failure-mode categories — Reviewer never overlaps with Critic. The merger has an explicit `denylist` of Critic's `FailureModeId` values; if an LLM-reasoned Reviewer finding lands on a Critic category, it's dropped with a `redirect-to-critic` diagnostic.

## 5. Severity scale — `nit` / `suggestion` / `consider` / `praise`

Deliberately distinct from Critic's `low` / `medium` / `high` / `critical`. Reviewer's lexicon avoids any word that implies blocking:

| Severity | Meaning | Example |
|---|---|---|
| `praise` | Exemplary craftsmanship worth highlighting | "This factory function is a clean example of the parameterised-constructor pattern." |
| `nit` | Pure cosmetic — author can ignore freely | "Consider naming `x` to `index` in this loop." |
| `suggestion` | Improves readability with low effort | "Extract `60_000` to `DEFAULT_TIMEOUT_MS`." |
| `consider` | Meaningful refactor opportunity, low risk | "This 80-line function could split into `parseArgs` + `validateArgs` + `dispatch`." |

`praise` findings are emitted alongside corrective findings — positive reinforcement is part of Reviewer's design (Sourcery's "improvements an experienced dev would make" framing). The CLI default-formats `praise` findings first so reviewers see the wins before the suggestions.

`severityFloor` defaults to `nit` (everything surfaces); operator can raise to `suggestion` or `consider` to cut noise.

## 6. Architecture — two-tier detector pipeline (parallel to Critic)

```
                       ┌──────────────────────────────┐
                       │    DiffParser                │
                       │  unified diff → hunks[]      │
                       └───────┬──────────────────────┘
                               │
          ┌────────────────────┴───────────────────┐
          │                                        │
          ▼                                        ▼
┌────────────────────┐                  ┌────────────────────────┐
│ DETERMINISTIC TIER │                  │ LLM-REASONED TIER      │
│  (always on)       │                  │ (claude binary spawn)  │
│                    │                  │                        │
│ pattern-based      │                  │ craftsmanship prompt   │
│ scanners — one     │                  │ injection: hunks +     │
│ per dimension      │                  │ conventions → JSON     │
│ where rules can    │                  │ findings[]             │
│ be expressed as    │                  │                        │
│ regex / line-walk  │                  │ subscription-only —    │
│                    │                  │ no API key billing     │
└─────────┬──────────┘                  └───────────┬────────────┘
          │                                         │
          └──────────────────┬──────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  FindingMerger       │
                  │  dedup by id-hash    │
                  │  severity floor      │
                  │  Critic-overlap drop │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │ CraftsmanshipReview  │
                  └──────────────────────┘
```

We deliberately re-use the Critic patterns: `parseDiff` / `walkHunk` / `chunkHunk` shape, `findingId` hash, claude-binary subprocess, hallucination guard. The shared shape makes the two agents trivially comparable and keeps the maintenance load low.

### 6.1 Deterministic-tier detectors (10 dimensions where regex/line-walk suffices)

| Dimension | Detector heuristic |
|---|---|
| `naming-convention` | regex on added identifiers — single-letter names outside common iter (`i`/`j`/`k`/`x`/`y`); SCREAMING_SNAKE outside `const`; snake_case in TS source |
| `function-length` | line-walk: count consecutive added lines inside one function body; exceed `maxFunctionLines` |
| `file-length` | line-walk: count file's added line numbers; if max `newLine` > `maxFileLines` and the change is not just appending docs |
| `comment-density` | regex: `^export (function\|class\|interface\|type\|const)` added without a preceding `/**` block on the prior line |
| `magic-numbers` | regex: numeric literal `>= 100` or with `_` separator inside expression context (not in array index, not in test files) |
| `duplicate-imports` | line-walk: two `import` lines from the same module within the same file's added hunks |
| `deep-nesting` | line-walk: count leading whitespace indent units on added code lines; exceed `maxNestingDepth` |
| `todo-without-ticket` | regex: `TODO\|FIXME\|XXX` in added comments without a `[CAIA-\d+]` / `(#\d+)` reference |
| `console-logging` | regex: `console\.(log\|debug)` in `src/` files (warn/error are allowed; this catches debug rot) |
| `type-any` | regex: `:\s*any\b\|<any>\|as any\b` in TS source; allowlist for `unknown`-equivalent patterns |

These are **fast** (no LLM), **deterministic** (CI-safe), and **easily extended** (one file per detector). They cover the highest-density craftsmanship feedback patterns observed across CodeRabbit / Sourcery / Copilot review corpora.

### 6.2 LLM-reasoned tier (8 dimensions where craftsmanship reasoning is needed)

Dimensions where regex is insufficient — `idiom-adherence`, `abstraction-quality`, `suggested-refactor`, `test-design`, `error-handling-style`, `architecture-pattern`, `documentation-quality`, `api-ergonomics`. These need a model that reads the diff in context and reasons about whether the design choice is the most readable.

The LLM tier:
1. Takes the diff + Reviewer dimension descriptions + AGENTS.md craftsmanship excerpts as system + user prompt.
2. Calls `claude --print --output-format json --model claude-haiku-4-5-20251001`.
3. Explicitly nukes `ANTHROPIC_API_KEY` from spawned env (subscription-only).
4. Parses the model's JSON output (strict schema, retry-once-on-parse-failure handled at higher level).
5. Each LLM finding gets `source: 'llm-reasoned'` so users can filter.

The prompt template explicitly instructs the LLM to:
- Not flag anything in Critic's failure-mode taxonomy (those are Critic's domain).
- Bias toward `consider` and `suggestion`; emit `nit` only for clear improvements.
- Emit `praise` for exemplary craftsmanship (positive reinforcement — distinguishes Reviewer from Critic).
- Cap at ~5-10 findings per chunk; quality over quantity (Copilot baseline).

If `enableLlmReasoning: false` (test default), the LLM tier is skipped and only deterministic findings are returned.

### 6.3 Diff chunking

Identical to Critic — `chunkHunk(maxBytes)` ensures each LLM-tier prompt sees a bite-sized input. The merger dedups across chunks (same id-hash → keep first). Re-uses `chunkHunk` from Critic's shape (for now duplicated; eventual extraction into `@chiefaia/diff-utils` is a follow-up).

### 6.4 Severity scoring

A finding's severity comes from a static dimension → severity floor table, optionally overridden by the detector's own `severityHint`:

| Dimension | Default severity |
|---|---|
| `naming-convention` | nit |
| `function-length` | consider |
| `file-length` | consider |
| `comment-density` | suggestion |
| `magic-numbers` | suggestion |
| `duplicate-imports` | nit |
| `deep-nesting` | suggestion |
| `todo-without-ticket` | nit |
| `console-logging` | suggestion |
| `type-any` | consider |
| `idiom-adherence` | consider |
| `abstraction-quality` | consider |
| `suggested-refactor` | consider |
| `test-design` | suggestion |
| `error-handling-style` | suggestion |
| `architecture-pattern` | consider |
| `documentation-quality` | suggestion |
| `api-ergonomics` | consider |

Findings below `severityFloor` are dropped. There is NO `blockingFindings` — `CraftsmanshipReview.findings` is the only output list.

## 7. Differentiation from Critic — explicit guard

Reviewer's merger has an explicit `CRITIC_DENYLIST: Set<FailureModeId>` (the 18 IDs from `@chiefaia/critic`). Any LLM-tier finding whose `dimension` value happens to look like a Critic category is dropped before merge with a `dropped-redirect-to-critic` log line. This is defense-in-depth — the prompt asks the LLM not to overlap, the schema's `dimension` enum has no Critic IDs, and the merger drops anything that slipped through.

The deterministic detectors are designed to be disjoint by construction:
- Critic's `incompleteness` flags missing tests; Reviewer's `comment-density` flags missing JSDoc — distinct.
- Critic's `security-regression` flags credential shapes; Reviewer's `console-logging` flags debug-statement rot — distinct.
- Critic's `tool-misuse` flags raw curl when MCP exists; Reviewer's `duplicate-imports` flags style — distinct.

The two agents are explicitly designed to produce DIFFERENT findings on the same PR. E2E verification (Stage 8) measures the overlap — target `<5%` finding overlap by file+line+category.

## 8. Mentor / Librarian / aiml-architect integration

- **mentor-event-bus** dependency — Reviewer emits two event types it owns:
  - `reviewer.review.completed` — `{prNumber, totalFindings, durationMs, deterministic, llmReasoned}`
  - `reviewer.suggestion.surfaced` — `{prNumber, findingId, dimension, severity, source}` (one per finding)

  These flow into Mentor's existing index + clustering pipeline so a recurring Reviewer suggestion becomes a Steward-rule-proposal candidate (existing PR-2 path). This is the SOTA "advisory → enforcement" graduation path: low-friction suggestions that recur often become blocking rules over time.

- **guardrails-validator** dependency — every LLM-reasoned tier prompt is validated through the `inter-agent` profile before send (defense in depth).

- **aiml-architect** dependency — Reviewer queries `selectModel()` at construction time to confirm `claude-haiku-4-5` is the right routing target for "craftsmanship-review-pr"; if `aiml-architect` is unavailable, Reviewer falls back to its hard-coded default. Soft dependency.

- **Subscription-only LLM** — `claudeBinaryPath` invoked via `spawnSync` with `ANTHROPIC_API_KEY` deleted from env. Pattern cribbed from `apprentice-corpus/src/distiller.ts`.

## 9. Configuration matrix

| Param | Default | Test override | Production override |
|---|---|---|---|
| `conventionsPath` | `<repoRoot>/AGENTS.md` | `tests/__fixtures__/conventions/mini.md` | env `CAIA_CONVENTIONS_PATH` |
| `memoryRoot` | session memoryDir | `tests/__fixtures__/memory` | env `CAIA_MEMORY_ROOT` |
| `claudeBinaryPath` | `'claude'` | mock spawn fn | env `CLAUDE_BINARY_PATH` |
| `modelTag` | `'claude-haiku-4-5-20251001'` | n/a | env `REVIEWER_MODEL_TAG` |
| `enableLlmReasoning` | `true` | `false` | env `REVIEWER_LLM_ENABLED` |
| `severityFloor` | `'nit'` | `'nit'` | env `REVIEWER_SEVERITY_FLOOR` |
| `maxFunctionLines` | `60` | `60` | env `REVIEWER_MAX_FUNCTION_LINES` |
| `maxFileLines` | `500` | `500` | env `REVIEWER_MAX_FILE_LINES` |
| `maxNestingDepth` | `4` | `4` | env `REVIEWER_MAX_NESTING_DEPTH` |
| `maxFindingsPerPr` | `30` | `30` | env `REVIEWER_MAX_FINDINGS` |

## 10. Failure modes Reviewer itself watches for

Reviewer is recursive — it must not violate the same craftsmanship principles it polices:

- **Excessive findings**: `maxFindingsPerPr` cap defaults to 30, well below the 50-cap Critic uses, because review noise erodes trust faster than blocking-finding noise (industry data — Copilot tunes for ~5/PR).
- **False praise**: `praise` findings are emitted only by the LLM tier when explicitly asked; deterministic detectors never emit praise (no signal to base it on).
- **Hallucination**: every LLM-reasoned finding includes the offending diff `excerpt`; if the excerpt isn't in the actual diff, the finding is dropped before merging.
- **Redirect-to-Critic guard**: explicit denylist of Critic categories.
- **Style pedantry**: severity floor defaults are tuned so naming-conv / TODO / duplicate-import dims are `nit`; only LLM-reasoned and structural findings get `consider`.

## 11. Boundary — what Reviewer does NOT do

- Does not block the merge — Reviewer NEVER produces `blockingFindings`. Steward only consumes Critic's blockers.
- Does not write code fixes — that's the producing agent's job after seeing Reviewer's comments.
- Does not flag security / cost / regressions — that's Critic's domain.
- Does not run tests / CI — Evidence Gate.
- Does not refactor — Coding Agent.

Reviewer is purely **craftsmanship review**: read → suggest cleaner expression → file findings as advice.

## 12. References

- `agent_ecosystem_expansion_directive.md` ## A2 / item 9.5 — Reviewer Agent
- `agent_architecture_shape_2026-05-06.md` — Option E
- `feedback_critic_agent_two_tier_detector_pattern.md` — Critic's pattern Reviewer mirrors
- `packages/critic/DESIGN.md` — sibling agent design (read for delta)
- `feedback_no_api_key_billing.md` — subscription-only LLM
- `feedback_concurrent_agents_worktree_isolation.md` — worktree shape used by this leg
- `packages/apprentice-corpus/src/distiller.ts` — `claude` binary subprocess pattern Reviewer re-uses
- `packages/mentor-retrieval/src/steward-rule-proposer.ts` — upstream consumer of `reviewer.suggestion.surfaced` events
- CodeRabbit / Sourcery / Greptile / GitHub Copilot Code Review — SOTA tools that converge on the block-vs-advisory split Reviewer formalises here
