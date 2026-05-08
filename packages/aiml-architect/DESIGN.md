# `@chiefaia/aiml-architect` — Phase 1 Design

**Status**: Item 8.5 in master sequencing — first of 12 architect agents. Ships as the AI/ML Architect Agent per `agent/memory/architect_agents_directive.md` §7.
**Shape**: Option E — CAIA-Bonded Skeleton (per `agent/memory/agent_architecture_shape_2026-05-06.md`).
**Author**: AIML Architect Agent leg 1 (2026-05-06). Stages 1-3 deliverable in this leg; Stages 4-10 land in subsequent legs of the same campaign.

## 1. Mandate

Today's AI/ML decisions are scattered across CAIA:

- **Curator** tracks cost dimensions (one of the 10 categories is "Subscription & Resource Efficiency") but doesn't *decide* which model to pick.
- **Apprentice** runs the LoRA loop (Phase 0 corpus shipped, Phase 1 eval design-only) but doesn't *decide* when to retrain, what win-rate threshold to enforce, or which adapters to bless.
- **Mentor** logs model failures via `HallucinationFlagged`, `EvidenceGateFailure`, `RegressionDetected`, etc. but doesn't *decide* what to do about them.
- **Promptfoo** (`@chiefaia/prompt-evals`) runs eval suites for 10 agents but there's no canonical 100-prompt suite that all agents must clear.
- **DSPy** (`@chiefaia/dspy-bridge`) exposes compile/predict but no pattern says when to compile vs when to hand-write.
- **Local LLM Router** (`@chiefaia/local-llm-router`) carries 30+ task-type routing rules in `routing-config.ts` but the rules are heuristic — no formal review process, no taxonomy doc, no decision tree.

The AI/ML Architect Agent is the single place where these decisions are *unified into a coherent practice*. It serves OTHER agents (EA, Coding, Fix-It, Critic) — operator never invokes directly (per `feedback_operator_does_not_code.md`).

The agent has four primary responsibilities:

1. **Model selection authority** — given a task category + context size + quality bar, return the canonical model choice (Claude tier, Ollama tag, or Apprentice adapter) along with the rationale.
2. **Prompt-pattern review** — given a prompt template, score it against industry-standard patterns (CoT, few-shot, structured output, role-prompting), flag anti-patterns (token waste, ambiguity, missing JSON shape constraints), recommend DSPy compilation when warranted.
3. **Canonical eval suite ownership** — own the 100-prompt suite that lives at `packages/apprentice-eval/suites/canonical-100.yaml` and is mirrored as a Promptfoo-compatible configuration. Decides when prompts are added/retired.
4. **Apprentice loop coordination** — read Mentor's failure events + Curator's cost dimensions to decide *when* a retraining cycle should fire, what threshold to enforce, and which dimensions to weight in the eval.

The agent's first deliverable per directive §7 is `caia/docs/ai-ml-architecture-conventions.md` — operator-grade AI/ML standard.

## 2. Package shape (Option E checklist)

- ✅ `packages/aiml-architect/` (NOT `apps/aiml-architect/` — apps are runtime services consuming agent packages).
- ✅ `package.json`: `"private": true`, scope `@chiefaia/aiml-architect`, never published.
- ✅ Public API parameterised via `AIMLArchitectConfig` constructor — every CAIA path / model catalog / eval suite root is a parameter with a CAIA default. Tests inject fixtures.
- ✅ Tests inject fixture model catalogs + fixture eval suites + a fake `MentorEventBus` + a fake `CuratorScanner`. Never live CAIA paths.
- ✅ Pre-spawn injection: when this agent generates a recommendation that's surfaced to another agent (e.g., a model-choice rationale prepended to Coding-Agent's task prompt), the surface goes through Mentor + Librarian retrieval first. The package itself does not bypass.
- ✅ AGENTS.md (already filed at repo root) is consulted for build/test/lint commands.

## 3. Public API

```typescript
import { AIMLArchitect } from '@chiefaia/aiml-architect';

const architect = new AIMLArchitect({
  // All optional — CAIA defaults filled in.
  modelCatalog: defaultModelCatalog,           // wraps @chiefaia/local-llm-router's MODEL_CATALOG
  routingRules: defaultRoutingRules,           // wraps ROUTING_RULES from local-llm-router
  apprenticeEvalSuiteRoot:
    'packages/apprentice-eval/suites',
  canonicalSuitePath:
    'packages/apprentice-eval/suites/canonical-100.yaml',
  promptfooEvalRoot:
    'packages/prompt-evals/evals',
  conventionsDocPath:
    'caia/docs/ai-ml-architecture-conventions.md',
  mentorEventsDbPath: '~/.caia/mentor/events.sqlite',
  curatorScanRoot: '~/Documents/projects/reports',
  apprenticeAdapterRegistryRoot:
    '~/Documents/projects/apprentice/adapters',
  apprenticeCorpusRoot:
    '~/Documents/projects/apprentice/corpora',
  // Behaviour knobs:
  retrainTriggerWindow: { days: 7 },           // Mentor failures within this window count
  retrainTriggerThreshold: 5,                  // ≥5 model-failure events → recommend retrain
  retrainCostBudgetUsd: 5,                     // Cost ceiling for one retraining cycle
  promotionWinRateThreshold: 0.6,              // adapter must beat base by this margin
  forgettingThreshold: 0.1,                    // any baseline regression > 10% disqualifies
  preferLocalIfRamGB: 11,                      // Mac M1 Pro hardware budget
  // Dependency injection (test seams):
  fs: defaultFsReader,
  mentor: defaultMentorEventBus,
  curator: defaultCuratorReader,
  clock: () => new Date(),
});

// 1. Model selection
const choice = architect.selectModel({
  taskCategory: 'code-implementation-simple',
  contextSizeTokens: 4_000,
  qualityBar: 'standard',                      // 'best-effort' | 'standard' | 'high'
  hardware: 'mac-m1-pro-16gb',
});
// → { provider: 'local', model: 'qwen2.5-coder:7b', rationale: '...', adapter?: '...' }

// 2. Prompt-pattern review
const review = architect.reviewPromptPattern({
  templateId: 'apprentice-corpus.distiller',
  template: '...the prompt template body...',
  intendedTaskCategory: 'distill',
});
// → { score: 0.72, findings: [...], recommendDspyCompile: false, rewriteSuggestion: '...' }

// 3. Canonical eval suite ownership
const suite = architect.ownEvalSuite();
// → { path, promptCount, lastUpdated, perTaskCategoryCoverage, integrityIssues: [...] }

// 4. Apprentice loop coordination
const plan = architect.coordinateApprenticeLoop();
// → { decision: 'retrain' | 'hold' | 'promote-canary' | 'rollback',
//     rationale, candidateAdapter?, estimatedCostUsd, eligibleSinceMs }
```

All four methods are pure-ish: read state from injected dependencies, return a structured verdict. They never mutate (no DB writes, no LaunchAgent triggers — those are the orchestrator's job to act on the verdict).

CLI:

```bash
# One-shot model selection
caia-aiml-architect select --task code-implementation-simple --context 4000 --quality standard

# Review a prompt template
caia-aiml-architect review --template-id apprentice-corpus.distiller --template-file ./template.md

# Audit the canonical eval suite
caia-aiml-architect eval-audit

# Apprentice-loop coordination verdict
caia-aiml-architect coordinate

# Convention doc generation
caia-aiml-architect convention --output caia/docs/ai-ml-architecture-conventions.md

# Help
caia-aiml-architect --help
```

## 4. Pipeline / data flow

```
                        ┌─────────────────────────────────────────────┐
                        │ AIMLArchitect (this agent — verdict surface) │
                        └─────────────────────────────────────────────┘
                                          │
            ┌─────────────────────────────┼──────────────────────────────┐
            ▼                             ▼                              ▼
   ┌────────────────────┐       ┌──────────────────────┐     ┌──────────────────────┐
   │ selectModel()      │       │ reviewPromptPattern()│     │ ownEvalSuite()       │
   │  reads:            │       │  reads:              │     │  reads:              │
   │  - modelCatalog    │       │  - canonical patterns│     │  - canonicalSuitePath│
   │  - routingRules    │       │  - DSPy heuristics   │     │  - promptfooEvalRoot │
   │  - hardware budget │       │                      │     │  returns audit       │
   │ returns ModelChoice│       │ returns ReviewResult │     │                      │
   └────────────────────┘       └──────────────────────┘     └──────────────────────┘
                                                                       │
                                                                       ▼
                                                       ┌──────────────────────────┐
                                                       │ coordinateApprenticeLoop()│
                                                       │  reads:                   │
                                                       │  - mentor events DB       │
                                                       │  - curator cost dims      │
                                                       │  - apprentice adapter     │
                                                       │    registry               │
                                                       │  - canonical eval suite   │
                                                       │  returns TrainingPlan     │
                                                       └──────────────────────────┘
```

Verdicts are **decisions**, not requests. The orchestrator (or the calling agent) acts on them. The architect's verdicts pass through Mentor's pre-spawn injection layer when surfaced into another agent's prompt — the agent itself does not bypass.

## 5. Domain knowledge sources (the `architecturalInstructions[]` content)

The architect carries two layers of knowledge:

### 5a. Generic AI/ML domain (industry SOTA, baked at compile time)

Hard-coded into `src/knowledge/` as TypeScript modules — small, readable, version-controlled with the package. NOT a CAIA fact pile (those go in §5b); these are **stable industry rules**.

| Module | Content |
|---|---|
| `prompt-patterns.ts` | The 12 canonical prompt patterns (CoT, few-shot, role-prompting, structured output via JSON schema, self-consistency, retrieval-augmented generation, tree-of-thought, ReAct, …). Each has a name, the trigger pattern (when to use it), and an example. Used by `reviewPromptPattern()` to detect missing patterns + recommend application. |
| `dspy-heuristics.ts` | The decision rules for "when DSPy compile vs manual prompt": (1) high-frequency call (>1k/day); (2) reliability-sensitive (>99% required); (3) cross-model portable (we want to swap model later). If 2 of 3 → recommend DSPy. |
| `model-routing-decision-tree.ts` | The decision tree industry consensus: split on `task-domain × difficulty × role × hardware-budget`. Codified as a typed walker over `RoutingRule[]`. |
| `eval-methodology.ts` | The Promptfoo + DeepEval split: Promptfoo for fast CI gate; DeepEval (subprocess) for metric CI gate. Defines which assertion types belong on which side. |
| `forgetting-prevention.ts` | The catastrophic-forgetting taxonomy + mitigation rules (regression baselines, holdout retention, replay buffers). |

These modules are pure-data + pure-functions; tests are unit-tests over the rules.

### 5b. CAIA-specific AI/ML decisions (parameterised, project-bonded at runtime)

Pulled at runtime from injected dependencies + CAIA's existing data:

| Source | What we read |
|---|---|
| `@chiefaia/local-llm-router/MODEL_CATALOG` | 6 known local models with role/RAM/endpoint metadata |
| `@chiefaia/local-llm-router/ROUTING_RULES` | 30+ task-type → model rules (today's source of truth for routing) |
| `@chiefaia/mentor-event-bus` | failure events: `HallucinationFlagged`, `EvidenceGateFailure`, `RegressionDetected`, `DoDViolation`, `ToolMisuseFlagged` |
| `@chiefaia/curator` (cost-dim findings) | "Subscription & Resource Efficiency" finding stream |
| `@chiefaia/apprentice-corpus` `manifest.json` | corpus snapshots — used to time retrain windows |
| `~/Documents/projects/apprentice/adapters/` | adapter registry on disk |
| `packages/apprentice-eval/suites/` | eval suites (the architect *owns* the canonical 100-prompt one) |

The agent's "context narrowing" mechanism (per Option E) is: at runtime, when surfaced to another agent, the verdict prepends Mentor's failure-mode warnings + Librarian's nearest-neighbour precedent — the same convention every CAIA agent inherits. The agent's own logic does not need to re-implement this.

## 6. Methods — full contract

### 6a. `selectModel(params): ModelChoice`

```typescript
interface SelectModelParams {
  taskCategory: string;                        // e.g., 'code-implementation-simple'
  contextSizeTokens: number;                   // estimated input tokens
  qualityBar: 'best-effort' | 'standard' | 'high';
  hardware?: 'mac-m1-pro-16gb' | 'mac-m4-32gb' | 'cloud';   // default 'mac-m1-pro-16gb'
  forceProvider?: 'local' | 'claude' | 'apprentice';        // override (rare)
}

interface ModelChoice {
  provider: 'local' | 'claude' | 'apprentice';
  model: string;                               // ollama tag or claude model id
  adapter?: string;                            // if provider=apprentice
  rationale: string;                           // human-readable; goes into trace
  fallbackChain: ReadonlyArray<{ provider: ModelChoice['provider']; model: string }>;
  estimatedCostUsd: number;                    // 0 for local; routing-config estimate for Claude
}
```

Decision tree (in order):

1. If `forceProvider` is set, pick the canonical model for that provider for the task category.
2. If a canonical Apprentice adapter exists for the task category AND the adapter passed the canonical eval suite at promotion threshold, prefer Apprentice (Stage 3+ only — pre-Apprentice Phase 3 GA, this branch is dormant).
3. Look up the routing rule from `ROUTING_RULES`. If `qualityBar === 'high'`, force `useLocal=false`.
4. If hardware budget can't fit the local model (RAM > budget), escalate to Claude.
5. If context size exceeds local model's context window, escalate to Claude (or to a longer-context local like `mistral-nemo:12b`).
6. Build the `fallbackChain` per `routing-config.ts`'s rule: primary → secondary → tertiary.

### 6b. `reviewPromptPattern(params): ReviewResult`

```typescript
interface ReviewPromptPatternParams {
  templateId: string;                          // stable id for trace
  template: string;                            // the prompt template body
  intendedTaskCategory: string;
  expectedOutputShape?: 'plain' | 'json' | 'markdown' | 'code';
}

interface ReviewResult {
  score: number;                               // 0..1; 1 = ideal
  findings: ReadonlyArray<PromptFinding>;
  recommendDspyCompile: boolean;
  recommendDspyCompileReason?: string;
  rewriteSuggestion?: string;                  // if score < 0.5, propose a rewrite
}

interface PromptFinding {
  pattern: string;                             // 'cot' | 'few-shot' | 'role' | 'json-shape' | …
  severity: 'info' | 'warn' | 'error';
  detail: string;
  recommendation: string;
}
```

The reviewer:

1. Parses the template into a structured shape (system / user / assistant blocks if explicit; else infer).
2. Walks the canonical-pattern checklist:
   - Has the template specified the model's role? (anti-pattern: missing)
   - Does the template request structured output? (anti-pattern: free-form when JSON expected)
   - Does the template show few-shot examples? (warn if absent for classification task)
   - Does the template chain reasoning steps? (warn if absent for `formal-reasoning`)
3. Counts ambiguity signals (negation density, conditional pile-ups, undefined pronouns).
4. Flags token waste (re-stated context, vacuous filler).
5. Decides DSPy-compile recommendation: if 2 of 3 of {high-frequency, reliability-sensitive, cross-model-portable} → `recommendDspyCompile: true`.

The score is a weighted average over the findings; weights live in `knowledge/prompt-patterns.ts`.

### 6c. `ownEvalSuite(): EvalSuite`

```typescript
interface EvalSuite {
  path: string;                                // canonical-100.yaml path
  promptCount: number;
  lastUpdatedIso: string;                      // ISO timestamp
  perTaskCategoryCoverage: Record<string, number>;  // task → prompt count
  perAssertionTypeUsage: Record<string, number>;
  integrityIssues: ReadonlyArray<EvalIssue>;
}

interface EvalIssue {
  kind: 'missing-task-coverage' | 'duplicate-prompt' | 'unanchored-assertion' | 'stale-baseline';
  detail: string;
  promptId?: string;
}
```

The auditor reads the canonical 100-prompt YAML, validates:

- Every task category in `ROUTING_RULES` has ≥3 prompts in the suite (coverage gate).
- No two prompts have identical normalised content (dedup gate).
- Every assertion has an anchor (`contains` requires a value, `regex` requires a valid pattern, `javascript` requires a return statement).
- No prompt has a baseline older than 90 days (staleness gate — operator should bless or retire).

The architect's job is to FLAG; the orchestrator opens a remediation PR.

### 6d. `coordinateApprenticeLoop(): TrainingPlan`

```typescript
interface TrainingPlan {
  decision: 'retrain' | 'hold' | 'promote-canary' | 'rollback';
  rationale: string;
  candidateAdapterPath?: string;
  estimatedCostUsd: number;
  eligibleSinceMs?: number;                    // window start that triggered this
  failureSignals: ReadonlyArray<{
    eventType: string;
    count: number;
    sinceMs: number;
  }>;
  costSignals: ReadonlyArray<{
    dimension: string;
    severity: string;
    detail: string;
  }>;
}
```

Decision logic (in order):

1. **Rollback**: if any blessed adapter currently in production has triggered ≥3 `RegressionDetected` or `DoDViolation` events in the last 24h → rollback to base.
2. **Promote-canary**: if a candidate adapter exists in `apprenticeAdapterRegistryRoot` that has passed the canonical eval suite at `winRate ≥ promotionWinRateThreshold` AND has zero `forgettingThreshold` violations → recommend promote-canary.
3. **Retrain**: if the rolling 7-day Mentor event window contains ≥`retrainTriggerThreshold` model-attributable failures AND the most recent corpus snapshot is older than the trigger window → recommend retrain.
4. **Hold**: otherwise.

The architect's verdict is consumed by the Apprentice retrainer (Phase 4 — not yet built; the contract is forward-compatible).

## 7. Convention doc — Stage 8 first deliverable

`caia/docs/ai-ml-architecture-conventions.md` is the operator-facing AI/ML standard generated by `caia-aiml-architect convention`. Sections:

1. **Model routing decision tree** — the canonical taxonomy + the routing rule for each `taskCategory`. Updated alongside `routing-config.ts` PRs.
2. **Prompt engineering patterns** — the 12 canonical patterns + when to use each + anti-patterns.
3. **DSPy compilation policy** — when to compile vs manual; which programs in `dspy-bridge/programs/` are currently compiled.
4. **Eval methodology** — Promptfoo + DeepEval split; the canonical 100-prompt suite contract; how to add/retire prompts.
5. **Apprentice loop coordination** — retraining triggers; promotion thresholds; rollback rules.
6. **Failure-mode taxonomy** — Mentor events that are AI/ML-attributable + the architect's decision for each.
7. **Cost discipline** — Curator's "Subscription & Resource Efficiency" dimension; cost-attributable findings; the architect's response.
8. **Hardware budget** — Mac M-series RAM ceiling; cloud-GPU cap; when to escalate.
9. **Re-evaluation triggers** — what makes us reopen each decision.
10. **Glossary** — agent-specific terminology (adapter / canary / blessed / baseline / win-rate / forgetting).

The doc is regenerated on demand. Every regenerate produces a deterministic byte-identical output for the same inputs (same `routing-config.ts`, same `MODEL_CATALOG`, same canonical suite content).

## 8. Canonical 100-prompt eval suite — Stage 8 second deliverable

The suite lives at `packages/apprentice-eval/suites/canonical-100.yaml` and is the single source of truth for "did our AI/ML stack regress?". Structure:

```yaml
description: 'CAIA canonical AI/ML eval suite — 100 prompts spanning all task categories'
version: 1
maintainer: 'aiml-architect'

defaultTest:
  vars:
    agent: caia-canonical
  assert:
    - type: javascript
      value: 'output.length > 20 && output.length < 8000'

# 100 prompts across the 30 task categories from routing-config.ts.
# Coverage: ≥3 prompts per category (90 baseline) + 10 reserved for new
# categories (e.g., new architect-agent-driven tasks).
tests:
  # ─── code-implementation-simple (5 prompts) ────────────────────────
  - description: 'simple-impl: write a TS one-liner'
    vars:
      prompt: |
        Implement a TypeScript function `clamp(n, min, max)` that returns n
        clamped between min and max. ESM, no runtime deps.
    assert:
      - type: contains
        value: 'export'
      - type: regex
        value: 'Math\.(min|max)|n\s*[<>]'

  # ─── domain-classification (5 prompts) ─────────────────────────────
  - description: 'classify: an auth-domain request'
    vars:
      prompt: 'Add OAuth2 PKCE login to the Hono service.'
    assert:
      - type: contains
        value: 'auth'

  # ... 88 more prompts spanning every task category ...
```

**Selection rule**: prompts must be representative of CAIA's actual workload (drawn from PR titles + Mentor's `PromptReceived` payloads + the `apprentice-corpus`'s held-out set). They are NOT auto-generated; the architect curates them.

**Coverage gate**: at least 3 prompts per task category in `ROUTING_RULES`. Today that's 30 categories × 3 = 90 minimum; we ship 100.

**Stability**: the suite is versioned in git; changes to it are PR-gated through Evidence Gate. The `ownEvalSuite()` audit flags drift between the suite and the routing rules.

## 9. Output / verdict layout

When invoked via the CLI, verdicts land in `<reportsDir>/aiml-architect/<YYYY-MM-DD-HHmm>/`:

```
<reportsDir>/aiml-architect/<YYYY-MM-DD-HHmm>/
├── select-model.json              ← model selections (one per call)
├── prompt-reviews.json            ← prompt-pattern reviews
├── eval-audit.json                ← canonical-suite audit findings
├── coordinate-plan.json           ← apprentice-loop verdict
├── summary.md                     ← operator-facing one-pager
└── trace.jsonl                    ← raw event log (one JSON per line)
```

When invoked programmatically (from another agent), the verdict is the return value; no disk write happens unless explicitly opted in.

## 10. Risks + failure modes

| Risk | Mitigation |
|---|---|
| **R1**: Architect's routing decision diverges from `routing-config.ts` (drift) | The architect READS `routing-config.ts` via the dependency; it does not duplicate the rules. Any divergence = bug, caught by tests. |
| **R2**: Prompt review false-positives flag good prompts | Findings carry severity. `info`-level findings are advisory only; `warn` recommend review; only `error` is blocking. Default policy is non-blocking. |
| **R3**: DSPy-compile recommendation triggers compile loop on every call | Recommendation is metadata only; the orchestrator decides when to actually compile. The architect doesn't trigger compilation. |
| **R4**: Canonical suite grows past 100 + becomes unmaintainable | Hard cap at 200 prompts. Beyond that, the architect's audit recommends retiring prompts (oldest with passing rate ≥0.95 for ≥3 cycles). |
| **R5**: Apprentice loop verdict thrashes (retrain → rollback → retrain) | Hysteresis: once a `rollback` verdict fires, the architect's next 5 invocations are clamped to `hold` regardless of failure signals (de-bounce). |
| **R6**: Mentor event volume floods the coordinator | Coordinator queries are bounded — `since-ms` window + `LIMIT 500`. Anything past that aggregates into a "high-frequency-mode" verdict (still `retrain`, but with `rationale: 'flood mode'`). |
| **R7**: Hardware budget assumption wrong (operator gets a new Mac) | `hardware` parameter is per-call; default is the safe `mac-m1-pro-16gb`. Operator overrides via CLI flag or env var (`CAIA_HARDWARE`). |
| **R8**: Convention doc regeneration is non-deterministic | The generator sorts every list alphabetically; timestamps are read from injected `clock`; tests assert byte-identical output for fixed inputs. |
| **R9**: DeepEval bridge subprocess fails / not installed | DeepEval is OPTIONAL. The architect's eval-audit notes its absence as `info`-level. The Promptfoo path always works (already shipped). |
| **R10**: The architect's verdict is wrong (operator disagrees) | All verdicts carry rationale; operator can append a `feedback_aiml_architect_*.md` to memory and Mentor's pre-spawn injection brings it into the next invocation. |

## 11. Hard constraints (non-negotiables this package respects)

- 🚨 **Subscription-only LLM**. The architect itself does NOT call any LLM at runtime — all four methods are pure analysis over injected state. The only LLM use is when its verdicts are surfaced into another agent's prompt; that goes through the standard `claude` binary subscription path.
- 🚨 **Operator does NOT code**. The operator never invokes this package directly; it serves OTHER agents. The CLI is for orchestrator and developer ergonomics.
- 🚨 **No paid GPU**. Inference choices respect Mac M-series RAM budget; cloud GPU only when training (Apprentice's bailiwick, not this agent's).
- 🚨 **Decision-classifier**: the architect **decides** (it returns a verdict) and **never asks**. If a verdict needs operator input (e.g., a new `taskCategory` not in the catalog), the architect returns `decision: 'hold'` with `rationale: 'unknown task category — operator should add to routing-config.ts'`. The orchestrator surfaces that to the operator.
- 🚨 **No silent state mutations**. The architect only reads. Writes (eval suite updates, convention doc regeneration, Apprentice retrain triggers) go through other agents / orchestrator code; the architect just emits the verdict.
- 🚨 **Option E**: parameterised, fixture-tested, never published, single-customer (CAIA).

## 12. Package layout (for Stages 4-10, this leg + next)

```
packages/aiml-architect/
├── DESIGN.md                           ← this file (Stage 3)
├── README.md                           ← Stage 10
├── package.json                        ← private @chiefaia/aiml-architect
├── tsconfig.json + tsconfig.build.json
├── eslint.config.cjs
├── vitest.config.ts
├── src/
│   ├── types.ts                        ← ModelChoice, ReviewResult, EvalSuite, TrainingPlan, …
│   ├── config.ts                       ← AIMLArchitectConfig + resolveConfig() with CAIA defaults
│   ├── knowledge/
│   │   ├── prompt-patterns.ts          ← 12 canonical patterns + anti-patterns
│   │   ├── dspy-heuristics.ts          ← DSPy compile decision rules
│   │   ├── model-routing-decision-tree.ts  ← routing decision walker
│   │   ├── eval-methodology.ts         ← Promptfoo + DeepEval split
│   │   └── forgetting-prevention.ts    ← catastrophic-forgetting taxonomy
│   ├── select-model.ts                 ← selectModel() implementation
│   ├── review-prompt-pattern.ts        ← reviewPromptPattern() implementation
│   ├── own-eval-suite.ts               ← ownEvalSuite() audit implementation
│   ├── coordinate-apprentice-loop.ts   ← coordinateApprenticeLoop() implementation
│   ├── mentor-bridge.ts                ← read-only Mentor event-bus client
│   ├── curator-bridge.ts               ← read-only Curator finding stream client
│   ├── adapter-registry.ts             ← read-only Apprentice adapter discovery
│   ├── eval-suite-loader.ts            ← reads canonical-100.yaml
│   ├── convention-doc-generator.ts     ← writes ai-ml-architecture-conventions.md
│   ├── architect.ts                    ← top-level AIMLArchitect orchestration
│   ├── cli.ts                          ← caia-aiml-architect entry point
│   └── index.ts                        ← public API barrel
├── tests/
│   ├── __fixtures__/
│   │   ├── mini-routing-rules.ts       ← fake ROUTING_RULES
│   │   ├── mini-model-catalog.ts       ← fake MODEL_CATALOG
│   │   ├── mini-mentor-events.json     ← fake event log
│   │   ├── mini-curator-findings.json  ← fake finding stream
│   │   ├── mini-adapter-registry/      ← fake adapter dir
│   │   └── mini-canonical-suite.yaml   ← 10-prompt fixture suite
│   ├── helpers/
│   │   └── fakes.ts                    ← fake Mentor / Curator / FsReader
│   └── *.test.ts                       ← per-module unit tests + integration test
└── plists/                             ← (none — agent runs on demand from orchestrator)
```

No `plists/` — the architect runs on demand. (Apprentice retrainer's plist will *invoke* the architect, but the architect doesn't have its own cron.)

## 13. What this package depends on

Workspace deps (all `workspace:*`):

- `@chiefaia/local-llm-router` — for `MODEL_CATALOG`, `ROUTING_RULES`, types.
- `@chiefaia/mentor-event-bus` — for `EventType`, `EmittedEvent`, `Client.getRecent()`.
- `@chiefaia/apprentice-corpus` — for `CorpusManifest` shape (we read; never write).
- `@chiefaia/prompt-evals` — for the YAML eval-suite schema we mirror.

External deps:

- `js-yaml` — eval suite + canonical-100 YAML parsing.
- `vitest` — tests.

NOT depended on:

- `@chiefaia/dspy-bridge` — we recommend DSPy compilation but never invoke compile (that's the orchestrator's job).
- `@chiefaia/curator` — we read the digest output via FS, not the package internals (digest is the stable contract).
- `@chiefaia/apprentice-eval` — we author the canonical-100 suite *into* this package's `suites/` directory; we don't import from it (avoids circularity).
- DeepEval — optional + subprocess-only when invoked.

## 14. Stages 4-10 outline

**Stage 4 (Implement)** — leg 2:
- All `src/knowledge/*` modules with table-driven rules.
- `selectModel()` + `reviewPromptPattern()` + `ownEvalSuite()` + `coordinateApprenticeLoop()`.
- `mentor-bridge.ts` + `curator-bridge.ts` + `adapter-registry.ts` (FS read-only).
- `convention-doc-generator.ts` produces the conventions doc deterministically.
- CLI wiring.

**Stage 5 (Unit tests)** — leg 2:
- ~80 tests; ≥80% coverage.
- Fixture model catalogs, fixture event streams, fixture YAML suites.
- Each `selectModel()` decision-tree branch covered.
- Each `reviewPromptPattern()` finding type covered.
- Each `coordinateApprenticeLoop()` decision branch covered.

**Stage 6 (Integration test)** — leg 3:
- Wire the architect into ONE existing pipeline call: when `apps/orchestrator/src/agents/domain-specialists.ts` picks a model, prepend the architect's `selectModel()` rationale to the trace.
- Verify the rationale shows up in the trace via the Langfuse OTel span (`caia.aiml_architect.rationale` attribute).

**Stage 7 (Deploy)** — leg 3:
- No LaunchAgent. The agent is invoked on-demand from the orchestrator + CLI.
- Document orchestrator integration point in README + AGENTS.md.

**Stage 8 (E2E live verify)** — leg 4:
- File `caia/docs/ai-ml-architecture-conventions.md` (regenerated from the agent — must match deterministic output).
- File `packages/apprentice-eval/suites/canonical-100.yaml` (curated 100 prompts spanning all 30 task categories).
- Run `caia-aiml-architect coordinate` against live data; capture verdict.

**Stage 9 (Regression)** — leg 4:
- `pnpm --filter @chiefaia/aiml-architect build && test && lint && typecheck`.
- Whole-monorepo `pnpm -r typecheck && pnpm -r lint`.
- Tests cover: model selection, prompt review, eval audit, coordinate plan, knowledge modules.

**Stage 10 (Document + capture learnings)** — leg 4:
- README.md in the package.
- Final pass on this DESIGN.md.
- Completion report at `~/Documents/projects/reports/aiml-architect-complete-2026-05-06.md`.
- Memory directives if structural lessons emerge.

## 15. Cross-references to the 11 sibling architect agents

This is the FIRST of 12 architect agents (per `architect_agents_directive.md`). The other 11 will follow:

| # | Agent | Slot | Cross-reference to this agent |
|---|---|---|---|
| 1 | **AI/ML Architect (this)** | 8.5 | — |
| 2 | Frontend Architect | 11.5 | consumes our model-routing for AI-suggested UI states |
| 3 | Backend Architect | 11.6 | consumes our pattern review for prompt-injection-defence |
| 4 | Database Architect | 11.7 | independent; no direct coupling |
| 5 | Security Architect | 11.8 | consumes our prompt-pattern review for OWASP LLM Top 10 |
| 6 | DevOps Architect | 11.9 | consumes our hardware-budget logic for deployment topology |
| 7 | Performance Architect | 11.10 | tightly coupled — performance budgets feed our quality bar |
| 8 | Docs Architect | 13.5 | consumes our conventions doc as a structured artifact |
| 9 | Integration Architect | 14.5 | consumes our model-routing for inter-service contract negotiation |
| 10 | Data Architect | 14.6 | independent; no direct coupling |
| 11 | API Architect | 18.5 | productisation — out of scope |
| 12 | UX Architect | 18.6 | productisation — out of scope |

Each subsequent architect agent will follow this same 10-stage DoD, this same Option E shape, and consume this agent's verdicts where AI/ML decisions are involved.

## See also

- `agent/memory/architect_agents_directive.md` — the 12-agent campaign spec (this is agent #1).
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E standing rule.
- `agent/memory/apprentice_agent_directive.md` — Apprentice campaign whose Phase 4 retrainer consumes our `coordinateApprenticeLoop()` verdict.
- `agent/memory/feedback_no_api_key_billing.md` — subscription-only LLM rule.
- `agent/memory/feedback_operator_does_not_code.md` — operator-as-developer rule (architect serves other agents).
- `packages/local-llm-router/README.md` — the routing-config.ts contract we read.
- `packages/mentor-event-bus/README.md` — the event-bus client contract we read.
- `packages/apprentice-eval/DESIGN.md` — the sibling Apprentice eval harness; canonical-100.yaml is shared.
- `packages/prompt-evals/README.md` — the Promptfoo wrapper we mirror.
- `~/Documents/projects/reports/caia-enterprise-architecture-comprehensive-2026-05-06.md` §6.3 — the audit that filed this campaign.
