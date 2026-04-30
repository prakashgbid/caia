// Routing rules for @chiefaia/local-llm-router
// Determines which tasks go local vs Claude API

export interface RoutingRule {
  taskType: string;
  description: string;
  localModel: string;
  claudeModel?: string; // fallback if local fails
  useLocal: boolean;
  maxTokens: number;
  estimatedCostLocal: string; // per 1000 calls
  estimatedCostClaude: string; // per 1000 calls
}

export const ROUTING_RULES: RoutingRule[] = [
  // ─── ALWAYS LOCAL — pattern-matching / classification ────────────────────
  {
    taskType: 'domain-classification',
    description: 'Classify text into functional domains (auth, ui, api, etc.)',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.05',
  },
  {
    taskType: 'nature-classification',
    description: 'Classify task nature (feature/bug/refactor/chore)',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 300,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.03',
  },
  {
    taskType: 'embedding-generation',
    description: 'Generate text embeddings for similarity search',
    localModel: 'nomic-embed-text',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.20',
  },
  {
    taskType: 'dedup-check',
    description: 'Check if a requirement is similar to existing ones',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 800,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.08',
  },

  // ─── ALWAYS LOCAL — small generative tasks (LAI-005) ─────────────────────
  // The 7B coder is comfortable here and warm-call latency (~170 ms) makes
  // these indistinguishable from Claude in practice.
  {
    taskType: 'commit-message',
    description: 'Generate a Conventional Commits message from a diff or summary',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 400,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.04',
  },
  {
    taskType: 'pr-summary',
    description: 'Summarize a PR — what / why / risk — from commits + diff stat',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },
  {
    taskType: 'code-explanation',
    description: 'Explain what a snippet of code does in plain English',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },

  // ─── LOCAL PREFERRED — story / requirement work ──────────────────────────
  {
    taskType: 'story-enrichment',
    description: 'Add acceptance criteria and implementation notes to a story',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.50',
  },
  {
    taskType: 'test-generation-simple',
    description: 'Generate unit tests for a simple function',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 3000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.75',
  },
  {
    taskType: 'code-implementation-simple',
    description: 'Implement a well-defined, scoped coding task (< 100 lines)',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'changelog-generation',
    description: 'Generate changelogs from git commits or task descriptions',
    localModel: 'llama3.1:8b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.40',
  },
  {
    taskType: 'status-summarization',
    description: 'Summarize project status, task lists, progress reports',
    localModel: 'llama3.1:8b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.40',
  },

  // ─── LOCAL PREFERRED — moved from CLAUDE-ONLY by LAI-005 ─────────────────
  // qwen3:14b is strong enough on these for a first pass; Claude is the
  // automatic fallback if the local model errors. Quality is then verified
  // downstream by tests / lint / human review.
  {
    taskType: 'code-review-light',
    description:
      'First-pass code review — naming, simple smells, obvious bugs. Does ' +
      'NOT replace human / Claude security or architecture review.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'requirement-deduplication',
    description:
      'Decide whether two requirement statements are duplicates. ' +
      'Cheap-and-fast first pass before invoking the full dedup engine.',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 600,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.06',
  },
  {
    taskType: 'formal-reasoning',
    description:
      'Step-by-step reasoning on math / STEM / formal logic. Phi-4 is ' +
      'GPT-4o-mini-class on MATH and GPQA at 14B parameters.',
    localModel: 'phi4',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'hierarchy-decomposition-rough',
    description:
      'First-pass hierarchy decomposition — Initiative→Epic→Story sketch ' +
      'that a human / Claude refines. Distinct from hierarchy-decomposition ' +
      'which still routes Claude for the production path.',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 6000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.50',
  },

  // ─── PO recursive decomposer (PO-DECOMP-### track) ───────────────────────
  // Per the proposal in `reports/po-decomposition-architecture-proposal-2026-04-29.md`,
  // the recursive decomposer fans out into a small number of task-types:
  // classification (Ollama-first), per-scope decomposition (Sonnet for high
  // scopes, Ollama-first for deep scopes), and a judge pair (Sonnet, with
  // ensemble for initiative/epic).
  {
    taskType: 'po-decomposer-scope-detection',
    description:
      'Adaptive scope detector — classify a prompt as initiative | epic | ' +
      'module | story | task | subtask. Cheap classification call.',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 400,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.04',
  },
  {
    taskType: 'po-decomposer-atomicity-classification',
    description:
      'Per-scope atomicity classifier — does a candidate child satisfy the ' +
      'INVEST/SAFe/DDD rubric for its scope? Cheap classification call.',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 600,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.06',
  },
  {
    taskType: 'po-decomposer-initiative',
    description:
      'Initiative → epic decomposition. High-stakes (multi-quarter scope).',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'po-decomposer-epic',
    description:
      'Epic → module decomposition. High-stakes (single PI scope).',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'po-decomposer-module',
    description:
      'Module → story decomposition. Medium-stakes (bounded-context scope).',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 6000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.50',
  },
  {
    taskType: 'po-decomposer-story',
    description:
      'Story → task decomposition. Medium-stakes (single-PR scope).',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'po-decomposer-task',
    description:
      'Task → subtask decomposition. Low-stakes (single-day scope) — Ollama-first.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 3000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.75',
  },
  {
    taskType: 'po-decomposer-subtask',
    description:
      'Subtask → mechanical-step decomposition. Rarely needed; Ollama-first.',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'po-decomposer-coverage-judge',
    description:
      'Parent-coverage MECE judge. Did the children cover the parent\'s scope? ' +
      'Sonnet — judging is high-leverage low-cost relative to regenerating downstream.',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.40',
  },
  {
    taskType: 'po-decomposer-disjointness-judge',
    description:
      'Sibling-disjointness MECE judge. Do any two children overlap?',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.40',
  },

  // ─── CLAUDE ONLY — still too high-stakes for the local path ──────────────
  {
    taskType: 'hierarchy-decomposition',
    description: 'Break a prompt into Initiative→Epic→Story→Task hierarchy',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'architecture-decision',
    description: 'Make architectural decisions, produce ADRs',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-opus-4-6',
    useLocal: false,
    maxTokens: 6000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$3.00',
  },
  {
    taskType: 'code-implementation-complex',
    description:
      'Complex multi-file implementation, novel algorithms, system design',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false, // local quality not reliable enough for complex
    maxTokens: 16000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$4.00',
  },
  {
    taskType: 'security-review',
    description: 'Security audit, vulnerability analysis',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
];

export function getRoute(taskType: string): RoutingRule {
  const rule = ROUTING_RULES.find((r) => r.taskType === taskType);
  if (!rule) {
    // Default: use Claude Sonnet for unknown task types
    return {
      taskType,
      description: 'Unknown task type',
      localModel: 'qwen2.5-coder:7b',
      claudeModel: 'claude-sonnet-4-6',
      useLocal: false,
      maxTokens: 4000,
      estimatedCostLocal: '$0.00',
      estimatedCostClaude: '$1.00',
    };
  }
  return rule;
}

// ─── Cost analysis ─────────────────────────────────────────────────────────
//
// Recomputed by LAI-005. The math: at 1000 agent invocations/day with the
// task-type mix the orchestrator currently produces, the share of calls
// that route LOCAL grows from ~55% (pre-LAI) to ~75-80% (post-LAI-005),
// because most code-review / pr-summary / formal-reasoning / first-pass
// decomposition work no longer needs Claude.
//
// At an average Claude cost of $1/1k calls across the rule mix:
//   pre-LAI:  ~ 450 Claude calls/day × $1 / 1000 calls × 30 days ≈ $13.50/day
//             scaled to $600–$1,200/month at higher per-call cost mixes
//   post-LAI: ~ 200 Claude calls/day → $90–$180/month
export const COST_ANALYSIS = {
  withoutLocalLLM: '$600–$1,200/month (all Claude)',
  withLocalLLM: '$90–$180/month (~75-80% local)',
  estimatedSavings: '$510–$1,020/month (~85% reduction)',
  breakEven: 'Immediate (Ollama is free)',
};
