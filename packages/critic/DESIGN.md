# `@chiefaia/critic` — Design

**Status**: Tier-A item 9 of `agent_ecosystem_expansion_directive.md` — pre-commit adversarial review agent.
**Shape**: Option E (`agent_architecture_shape_2026-05-06.md`).
**Author**: 2026-05-06 (Critic-001 leg).
**Distinct from Reviewer (item 9.5)**: Critic is ADVERSARIAL — finds what's wrong, novel attack vectors. Reviewer is CRAFTSMANSHIP — readability, idioms, maintainability.

## 1. Mandate

Before any non-trivial PR is merged, the Critic Agent attempts to break the change adversarially. It reads the unified diff plus the surrounding repository context, generates a list of attack vectors, and files them as PR comments with severity, file/line, and reproduction steps. Other agents must address Critic's findings before the PR can pass the Steward gate.

**Why this prevents real bugs** (operator-confirmed in directive): most prior CAIA mistakes (Drizzle migration breakpoint, scheduled-task hung session, premature stage-6 declarations) were predictable failures nobody pressure-tested. Critic institutionalises pre-commit pressure-testing using Mentor's accumulated 18-category failure-mode taxonomy as the corpus.

## 2. Package shape (Option E checklist)

- ✅ `packages/critic/` (NOT `apps/critic/` — apps consume packages)
- ✅ `package.json`: `"private": true`, scope `@chiefaia/critic`, never published
- ✅ Public API parameterised via `CriticAgentConfig` constructor — every CAIA path / topic / registry / failure-mode source is a parameter with a CAIA default
- ✅ Tests inject fixture diffs + fixture taxonomy at `tests/__fixtures__/{diffs,taxonomy}/` — never live CAIA paths
- ✅ Pre-spawn injection: when Critic dispatches its adversarial-review prompt to the `claude` binary, the prompt passes through `caia-mentor-prepend | caia-librarian-prepend` (orchestrator-side wiring; package itself does not bypass)
- ✅ AGENTS.md is consulted for build/test/lint commands — package has no special override

## 3. Public API

```typescript
import { CriticAgent } from '@chiefaia/critic';

const critic = new CriticAgent({
  // All optional — CAIA defaults filled in by constructor.
  taxonomyPath: '~/.../mentor_agent_directive.md',     // Mentor's 18-category list
  memoryRoot:   '~/.../agent/memory',                   // feedback_*.md corpus
  reportsRoot:  '~/Documents/projects/reports',
  eventBusUrl:  'tcp://localhost:7777',                 // mentor-event-bus
  claudeBinaryPath: 'claude',
  modelTag: 'claude-haiku-4-5-20251001',
  // Behaviour knobs:
  maxDiffBytes:  256_000,        // chunk diffs above this
  chunkBytes:     64_000,
  severityFloor: 'low',          // suppress findings below this severity
  perVectorTimeoutMs: 60_000,
  maxFindingsPerPr: 50,
  // Adversarial reasoning toggles
  enableLlmReasoning: true,      // off → fall back to deterministic-only
  enableDeterministic: true,     // pattern-based scanning always runs
  // Test seams (DI):
  fs:        defaultFsReader,
  taxonomy:  defaultTaxonomyLoader,   // reads taxonomyPath → FailureModeCategory[]
  llm:       createDefaultLlmClient(...),  // claude-binary subprocess
  clock:     () => new Date(),
});

const review: AdversarialReview = await critic.reviewPR({
  prNumber: 393,
  diff: '<unified diff text>',
  context: { branch: 'feat/critic-001-design', baseBranch: 'develop', title: '...' }
});
```

CLI surface:

```bash
caia-critic review --pr 393                      # use CAIA defaults
caia-critic review --pr 393 --diff-file ./pr.diff
caia-critic review --pr 393 --output json        # machine-readable
caia-critic review --pr 393 --severity-floor medium
caia-critic dry-run --diff-file ./pr.diff        # adversarial-review without writing PR comment
```

## 4. Output shape — `AdversarialReview`

```typescript
interface AdversarialReview {
  prNumber: number;
  reviewedAtIso: string;
  totalFindings: number;
  findings: AdversarialFinding[];
  summary: {
    countBySeverity: Record<Severity, number>;
    countByCategory: Record<FailureModeId, number>;
    chunksReviewed: number;
    durationMs: number;
    deterministic: number;       // findings from pattern-based scan
    llmReasoned: number;         // findings from LLM adversarial reasoning
  };
  blockingFindings: AdversarialFinding[];  // severity >= 'high'
}

interface AdversarialFinding {
  id: string;                                  // stable hash of (category|file|line|payload)
  category: FailureModeId;                     // one of the 18 Mentor categories
  severity: 'low' | 'medium' | 'high' | 'critical';
  file: string;
  line: number;
  attackVector: string;                        // human-readable name
  description: string;                         // why this is a problem
  reproductionSteps: string[];                 // concrete repro
  suggestedMitigation?: string;
  source: 'deterministic' | 'llm-reasoned';
  detectorId: string;                          // detector name for traceability
  excerpt: string;                             // ≤200 chars of the offending diff hunk
}

type FailureModeId =
  | 'hallucination'
  | 'scope-mismatch'
  | 'incompleteness'
  | 'wrong-direction'
  | 'lacking-information'
  | 'coordination-failure'
  | 'git-branch-hygiene'
  | 'cost-overrun'
  | 'security-regression'
  | 'operator-confusion'
  | 'premature-completion'
  | 're-litigation'
  | 'decision-classifier-violation'
  | 'memory-drift'
  | 'false-modesty'
  | 'recipe-rot'
  | 'tool-misuse'
  | 'ci-flake-masquerade';
```

The 18 categories map 1:1 to `mentor_agent_directive.md` ## Failure-mode taxonomy. Adding a 19th in Mentor's directive auto-extends Critic via `taxonomyPath` reload.

## 5. Architecture — two-tier detector pipeline

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
│ pattern-based      │                  │ adversarial prompt     │
│ scanners — one     │                  │ injection: hunks +     │
│ per category       │                  │ taxonomy → JSON        │
│ where rules can    │                  │ findings[]             │
│ be expressed as    │                  │                        │
│ regex / AST checks │                  │ subscription-only —    │
└─────────┬──────────┘                  │ no API key billing     │
          │                             └───────────┬────────────┘
          │                                         │
          └──────────────────┬──────────────────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  FindingMerger       │
                  │  dedup by id-hash    │
                  │  severity floor      │
                  │  taxonomy classify   │
                  └──────────┬───────────┘
                             │
                             ▼
                  ┌──────────────────────┐
                  │  AdversarialReview   │
                  └──────────────────────┘
```

### 5.1 Deterministic-tier detectors (10 categories where regex/AST suffices)

Each detector implements `Detector<Cat>`:

```typescript
interface Detector<Cat extends FailureModeId> {
  readonly id: string;            // e.g. 'det-premature-completion-claims-test'
  readonly category: Cat;
  scan(hunk: DiffHunk, ctx: ScanContext): AdversarialFinding[];
}
```

V1 ships 10 deterministic detectors:

| Category | Detector heuristic |
|---|---|
| `security-regression` | regex: literal credential shapes (sk-…, ghp_…, AKIA…) outside allowlisted fixture paths |
| `git-branch-hygiene` | regex: `force-push\|--force\|filter-branch` in CI / docs without `# justified:` annotation |
| `premature-completion` | regex in commit-message subject: `\b(complete|done|shipped)\b` + diff size < 50 lines |
| `decision-classifier-violation` | regex: `should I\|want me to\|your call\|let me know if` in operator-facing markdown / TODO / commit msg |
| `re-litigation` | check: any `feedback_*.md` slug from memory whose topic is in the diff body without referencing the feedback file |
| `tool-misuse` | regex: `curl http\b\|wget http\b` in code paths where `web_fetch`/MCP exists |
| `cost-overrun` | regex: `ANTHROPIC_API_KEY\b\|api\.anthropic\.com\b\|openai\.com/v1\b` outside test fixtures |
| `recipe-rot` | check: README/docs reference filenames not present in the diff's filesystem snapshot |
| `false-modesty` | regex: `I cannot\b\|I'm unable to\|impossible to\b` in agent output committed to repo |
| `incompleteness` | check: PR adds public symbol but no test under `tests/`/`__tests__/` |

These are **fast** (no LLM), **deterministic** (CI-safe), and **easily extended** (one file per detector). They cover the highest-frequency Mentor incident classes (decision-classifier + premature-completion + re-litigation accounted for >50% of clusters per Phase-4 retrieval data).

### 5.2 LLM-reasoned tier (8 categories where adversarial reasoning is needed)

Categories where regex is insufficient — `hallucination`, `scope-mismatch`, `wrong-direction`, `lacking-information`, `coordination-failure`, `operator-confusion`, `memory-drift`, `ci-flake-masquerade`. These need a model that can read the diff in context and reason about whether the change makes sense.

The LLM tier:
1. Takes the diff + the failure-mode taxonomy entries as system prompt + user prompt.
2. Calls `claude --print --output-format json --model claude-haiku-4-5-20251001`.
3. Explicitly nukes `ANTHROPIC_API_KEY` from the spawned env (subscription-only).
4. Parses the model's JSON output (strict schema, retry once on parse failure).
5. Each LLM finding gets `source: 'llm-reasoned'` so users can filter.

The prompt template is a composition of:
- A short adversarial-review system-prompt section ("you are a red-team reviewer; assume malice; find what could go wrong").
- The 18-category taxonomy with one-line descriptions (parsed from `mentor_agent_directive.md`).
- The diff hunk + filename + line numbers.
- A strict output schema (`{findings: [{category, severity, file, line, attackVector, description, reproductionSteps, suggestedMitigation}]}`).

If `enableLlmReasoning: false` (test default), the LLM tier is skipped and only deterministic findings are returned.

### 5.3 Diff chunking

Per the Datadog BewAIre lesson — large diffs degrade evaluation quality. Critic recursively chunks any diff exceeding `maxDiffBytes` into hunks of at most `chunkBytes`, and runs each tier per chunk. The merger dedups across chunks (same id-hash → keep first).

### 5.4 Severity scoring

A finding's severity comes from a static category → severity floor table, optionally overridden by the detector's own `severityHint`:

| Category | Default severity |
|---|---|
| `security-regression` | critical |
| `cost-overrun` | high |
| `git-branch-hygiene` | high |
| `premature-completion` | high |
| `re-litigation` | medium |
| `decision-classifier-violation` | medium |
| `tool-misuse` | medium |
| `incompleteness` | medium |
| `hallucination` | high |
| `scope-mismatch` | medium |
| `wrong-direction` | high |
| `lacking-information` | low |
| `coordination-failure` | medium |
| `operator-confusion` | low |
| `memory-drift` | medium |
| `false-modesty` | low |
| `recipe-rot` | low |
| `ci-flake-masquerade` | medium |

Findings below `severityFloor` are dropped. Any `severity >= 'high'` is added to `blockingFindings` — Critic's caller (orchestrator/Steward) is expected to block the merge until those are addressed.

## 6. Mentor / Librarian / aiml-architect integration

- **mentor-event-bus** dependency — Critic `emits` two event types it owns:
  - `critic.review.completed` — `{prNumber, totalFindings, blockingCount, durationMs, deterministic, llmReasoned}`
  - `critic.finding.surfaced` — `{prNumber, findingId, category, severity, source}` (one per finding, for taxonomy aggregation)

  These flow into Mentor's existing index + clustering pipeline so a recurring detector finding becomes a Steward-rule-proposal candidate (existing PR-2 path in `mentor-retrieval/src/steward-rule-proposer.ts`).

- **guardrails-validator** dependency — every LLM-reasoned tier prompt is validated through the `inter-agent` profile before send (defense in depth: prevents the diff itself from carrying a prompt-injection payload that turns Critic's own LLM call against us). The diff content is treated as `untrusted-user-input`.

- **aiml-architect** dependency — Critic queries `selectModel()` at construction time to confirm `claude-haiku-4-5` is the right routing target for "adversarial-review-pre-commit"; if `aiml-architect` is unavailable (e.g. fixture tests), Critic falls back to its hard-coded default. The dependency is **soft** — Critic ships and runs without aiml-architect on develop; the bridge is wired in Phase 2 once that PR merges.

- **Subscription-only LLM** — `claudeBinaryPath` invoked via `spawnSync` with `ANTHROPIC_API_KEY` deleted from env. Pattern cribbed from `apprentice-corpus/src/distiller.ts`.

## 7. Configuration matrix

| Param | Default | Test override | Production override |
|---|---|---|---|
| `taxonomyPath` | `<memoryRoot>/mentor_agent_directive.md` | `tests/__fixtures__/taxonomy/mini.md` | env `CAIA_TAXONOMY_PATH` |
| `memoryRoot` | session memoryDir | `tests/__fixtures__/memory` | env `CAIA_MEMORY_ROOT` |
| `claudeBinaryPath` | `'claude'` | mock spawn fn | env `CLAUDE_BINARY_PATH` |
| `modelTag` | `'claude-haiku-4-5-20251001'` | n/a | env `CRITIC_MODEL_TAG` |
| `enableLlmReasoning` | `true` | `false` (deterministic-only) | env `CRITIC_LLM_ENABLED` |
| `severityFloor` | `'low'` | `'low'` | env `CRITIC_SEVERITY_FLOOR` |
| `eventBusUrl` | `tcp://localhost:7777` | in-memory mock | env `MENTOR_EVENT_BUS_URL` |

## 8. Failure modes Critic itself watches for

Critic is recursive — it must guard against **its own** failures using the same taxonomy:

- **Premature completion**: Critic does NOT report `0 findings` unless every detector ran cleanly and no LLM call timed out — partial reviews surface as `incompleteness` findings on the review itself.
- **Hallucination**: every LLM-reasoned finding includes the offending diff `excerpt`; if the excerpt isn't in the actual diff, the finding is dropped before merging.
- **Cost overrun**: `perVectorTimeoutMs` + `maxFindingsPerPr` cap LLM-tier wallclock + token spend.
- **Re-litigation**: Critic emits findings with stable `id`s (hash of `category|file|line|attackVector`); the orchestrator deduplicates against prior PR comments before re-posting.

## 9. Boundary — what Critic does NOT do

- Does not block the merge directly — Critic emits findings; **Steward** (existing) is the gatekeeper that consumes blocking findings.
- Does not write code fixes — that's the producing agent's job after seeing Critic's comments.
- Does not enforce style / readability — that's Reviewer (item 9.5, comes after Critic).
- Does not run tests / CI — that's Evidence Gate.
- Does not refactor — that's Coding Agent.

Critic is purely **adversarial review**: read → find weaknesses → file findings.

## 10. References

- `agent_ecosystem_expansion_directive.md` ## A2 — Critic Agent
- `agent_architecture_shape_2026-05-06.md` — Option E
- `mentor_agent_directive.md` ## Failure-mode taxonomy — the 18 categories Critic classifies into
- `feedback_no_api_key_billing.md` — subscription-only LLM
- `feedback_concurrent_agents_worktree_isolation.md` — worktree shape used by this leg
- `packages/apprentice-corpus/src/distiller.ts` — `claude` binary subprocess pattern Critic re-uses
- `packages/mentor-retrieval/src/steward-rule-proposer.ts` — the upstream consumer of `critic.finding.surfaced` events
- Promptfoo (https://www.promptfoo.dev/docs/red-team/) — plugin × strategy decomposition pattern Critic mirrors
- RedCodeAgent (Microsoft Research, 2025) — automated red-team agent inspiration
- Datadog BewAIre — diff-chunking lesson
