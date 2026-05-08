# `@chiefaia/aiml-architect`

> AI/ML Architect Agent — first of 12 domain-specialist architect agents per `agent/memory/architect_agents_directive.md`. **Private** workspace package; never published.

## What this is

The agent that owns CAIA's AI/ML practice:

- **Model selection** — given a task category, context size, and quality bar, returns the canonical model choice (Claude tier, Ollama tag, or Apprentice adapter) with rationale + fallback chain.
- **Prompt-pattern review** — scores a prompt template against 12 canonical patterns (CoT, few-shot, role, JSON-shape, …) and recommends DSPy compilation when warranted.
- **Canonical eval suite ownership** — audits `packages/apprentice-eval/suites/canonical-100.yaml` for coverage, dedup, anchored assertions, stale baselines.
- **Apprentice loop coordination** — reads Mentor failure events + Curator cost-dim findings + adapter registry, returns a TrainingPlan (`retrain` / `hold` / `promote-canary` / `rollback`).

The agent serves OTHER agents (EA, Coding, Fix-It, Critic). Operator never invokes directly. No runtime LLM calls — pure analysis over injected state.

## Quick start

```typescript
import { AIMLArchitect } from '@chiefaia/aiml-architect';

const architect = new AIMLArchitect();   // CAIA defaults

// 1. Model selection
const choice = architect.selectModel({
  taskCategory: 'code-implementation-simple',
  contextSizeTokens: 4_000,
  qualityBar: 'standard',
});
// → { provider: 'local', model: 'qwen2.5-coder:7b', rationale: '...', fallbackChain: [...], estimatedCostUsd: 0 }

// 2. Prompt-pattern review
const review = architect.reviewPromptPattern({
  templateId: 'apprentice-corpus.distiller',
  template: '...the template body...',
  intendedTaskCategory: 'distill',
  expectedOutputShape: 'json',
});
// → { score: 0.72, findings: [...], recommendDspyCompile: false }

// 3. Eval suite audit
const suite = architect.ownEvalSuite();
// → { path, promptCount, perTaskCategoryCoverage, integrityIssues: [...] }

// 4. Apprentice loop coordination
const plan = architect.coordinateApprenticeLoop();
// → { decision: 'hold' | 'retrain' | 'promote-canary' | 'rollback', rationale, ... }

// 5. Convention doc regeneration (Stage 8 deliverable)
const md = architect.generateConventionsDoc();
// → markdown body for caia/docs/ai-ml-architecture-conventions.md
```

## CLI

```bash
caia-aiml-architect select --task code-implementation-simple --context 4000 --quality standard
caia-aiml-architect review --template-id apprentice-corpus.distiller --template-file ./template.md --task distill
caia-aiml-architect eval-audit
caia-aiml-architect coordinate
caia-aiml-architect convention --output caia/docs/ai-ml-architecture-conventions.md
caia-aiml-architect --help
```

## How the orchestrator wires this in

The architect emits **decisions**, not requests. Orchestrator + sibling agents act on the verdicts.

Recommended integration points:

### 1. Coding-Agent / EA / Fix-It → `selectModel()` before every `route()` call

Today, `apps/orchestrator/src/agents/domain-specialists.ts` (and similar) dispatch via `route()` from `@chiefaia/local-llm-router`. The thin lift is:

```typescript
import { route } from '@chiefaia/local-llm-router';
import { AIMLArchitect } from '@chiefaia/aiml-architect';

const architect = new AIMLArchitect();

async function pickAndRoute(taskCategory: string, prompt: string) {
  const choice = architect.selectModel({
    taskCategory,
    contextSizeTokens: estimateTokens(prompt),
    qualityBar: 'standard',
  });

  // Stamp the rationale onto the OTel span (matches the existing
  // gen_ai.* convention from apps/orchestrator/src/observability/agent-otel.ts).
  span.setAttributes({
    'caia.aiml_architect.provider': choice.provider,
    'caia.aiml_architect.model': choice.model,
    'caia.aiml_architect.rationale': choice.rationale,
  });

  // Today: route() reads its own routing-config.ts. The architect's
  // verdict either matches it (typical case) or — for forced overrides
  // — calls route(taskCategory, prompt, { forceClaude: true }).
  const opts = choice.provider === 'claude' ? { forceClaude: true } : {};
  return route(taskCategory, prompt, opts);
}
```

The architect doesn't replace `route()`; it adds a **decision-record layer** above it. Today the route configurations and the architect's table-driven decision tree are aligned (the architect READS `routing-config.ts`); divergences become bugs the test suite catches.

### 2. Apprentice retrainer (Phase 4) → `coordinateApprenticeLoop()` per cron tick

When Apprentice Phase 4 ships, its retrainer LaunchAgent should consult the architect at the start of every cycle:

```typescript
const plan = architect.coordinateApprenticeLoop();
switch (plan.decision) {
  case 'retrain':
    // Kick off Phase 0 → 1 → 2 → 3 chain with budget plan.estimatedCostUsd
    break;
  case 'promote-canary':
    // Phase 3 promotes plan.candidateAdapterPath
    break;
  case 'rollback':
    // Phase 3 reverts to base
    break;
  case 'hold':
    // Skip cycle
    break;
}
```

### 3. EA / Strategist → `reviewPromptPattern()` on every committed prompt template

Run as a Promptfoo-style gate on PRs that touch prompt templates. `score < 0.5` flags the PR; `recommendDspyCompile: true` opens an issue for the orchestrator to schedule a DSPy compile job.

### 4. Atlas / Reporter → `ownEvalSuite()` daily

Curator-style daily audit; surface integrity issues via the Curator digest.

## LaunchAgent

This package does NOT ship a LaunchAgent. The architect is invoked on demand from the orchestrator + the Apprentice retrainer + the CLI. Adding a cron-style invocation is a future option (e.g., daily `convention` regeneration) but not part of leg 1.

## Configuration

Every CAIA-specific path is a constructor parameter with a default — see `src/config.ts`:

```typescript
new AIMLArchitect({
  apprenticeEvalSuiteRoot: 'packages/apprentice-eval/suites',
  canonicalSuitePath: 'packages/apprentice-eval/suites/canonical-100.yaml',
  promptfooEvalRoot: 'packages/prompt-evals/evals',
  conventionsDocPath: 'caia/docs/ai-ml-architecture-conventions.md',
  mentorEventsDbPath: '~/.caia/mentor/events.sqlite',
  curatorScanRoot: '~/Documents/projects/reports',
  apprenticeAdapterRegistryRoot: '~/Documents/projects/apprentice/adapters',
  apprenticeCorpusRoot: '~/Documents/projects/apprentice/corpora',
  retrainTriggerWindowDays: 7,
  retrainTriggerThreshold: 5,
  promotionWinRateThreshold: 0.6,
  forgettingThreshold: 0.1,
});
```

Env-var overrides:

- `CAIA_APPRENTICE_SUITE_ROOT`
- `CAIA_CANONICAL_SUITE_PATH`
- `CAIA_PROMPTFOO_EVAL_ROOT`
- `CAIA_AIML_CONVENTIONS_DOC`
- `CAIA_EVENTS_DB`
- `CAIA_CURATOR_SCAN_ROOT`
- `APPRENTICE_ADAPTER_ROOT`
- `APPRENTICE_CORPUS_ROOT`

## Build / test / lint

```bash
pnpm --filter @chiefaia/aiml-architect build
pnpm --filter @chiefaia/aiml-architect test
pnpm --filter @chiefaia/aiml-architect lint
pnpm --filter @chiefaia/aiml-architect typecheck
```

## See also

- `DESIGN.md` — full design (~30k chars).
- `agent/memory/architect_agents_directive.md` — the 12-architect campaign.
- `agent/memory/agent_architecture_shape_2026-05-06.md` — Option E.
- `caia/docs/ai-ml-architecture-conventions.md` — auto-regenerated conventions doc.
- `packages/apprentice-eval/suites/canonical-100.yaml` — canonical 100-prompt suite owned by this agent.
- `packages/local-llm-router/README.md` — routing-config.ts source.
