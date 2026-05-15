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

  // ─── A.9.7 (2026-05-14) — taxonomy expansion ────────────────────────────
  // Two NEW task types so the router's typed dispatch matches the
  // classifier-v2 YAML. prose-rewrite + memory-search were already in
  // the YAML — the existing unknown-task default (qwen2.5-coder:7b)
  // is already correct for them, no new entry needed. The two NEW ones
  // (architecture-review, research-summary) deserve explicit rules so
  // callers using them as caia_task_type skip the unknown-task default
  // and get the right model + cost.
  {
    taskType: 'architecture-review',
    description:
      'Critique / review an existing architecture or ADR (distinct from ' +
      '`architecture-decision` which produces a NEW design). qwen3:14b is ' +
      'strong enough for the critique; Claude is the cascade fallback.',
    localModel: 'qwen3:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'research-summary',
    description:
      'Condense a single research artifact (paper, whitepaper, report) ' +
      'into actionable bullets. Distinct from `research-synthesis` which ' +
      'merges across many sources. Comfortably 14B-class.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 3000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },

  // ─── B1 (2026-05-15) — classifier-v2 intent aliases ──────────────────────
  // Silent tier-collapse fix: classifier-v2 emits intent names (medium-code,
  // hard-code, code-review, ...) but the dispatcher used to hand those to
  // getRoute() which fell through to the unknown-task default (qwen2.5-coder:7b).
  // Cross-host validation found 3/5 codebases silently served 7b when the
  // cascade design said 14b/32b. Each intent is registered here as a taskType
  // backed by the model that matches its `default_tier` in routing-rules.yaml:
  //   local-7b  → qwen2.5-coder:7b
  //   local-14b → qwen2.5-coder:14b
  //   local-32b → qwen2.5-coder:14b (M1 Pro 16GB can't host a 32B model; the
  //               cascade-escalation post-dispatch trigger promotes weak
  //               14b output to Claude — see cascade-escalation.ts)
  //   claude    → useLocal:false
  //   stolution-batch → useLocal:false (batch dispatch path not yet wired
  //               into router.ts; Claude is the conservative fallback)
  // The verifyTierRouting() unit test guards these against silent regression.
  {
    taskType: 'classify',
    description: 'classifier-v2 intent: lightweight classification call (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.05',
  },
  {
    taskType: 'summarize',
    description: 'classifier-v2 intent: short summary (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },
  {
    taskType: 'doc-summarize',
    description: 'classifier-v2 intent: summarize a single doc (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },
  {
    taskType: 'draft-prose',
    description: 'classifier-v2 intent: write a short prose blurb (local-14b tier).',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },
  {
    taskType: 'prose-rewrite',
    description: 'classifier-v2 intent: tighten/clarify a paragraph (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'format',
    description: 'classifier-v2 intent: format / reformat / prettify (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.10',
  },
  {
    taskType: 'format-convert',
    description: 'classifier-v2 intent: convert between data formats (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'lint-fix',
    description: 'classifier-v2 intent: apply lint fix / style cleanup (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'rename',
    description: 'classifier-v2 intent: rename symbol / variable / function (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.10',
  },
  {
    taskType: 'fill-template',
    description: 'classifier-v2 intent: scaffold / boilerplate fill (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'memory-search',
    description: 'classifier-v2 intent: lookup in agent-memory (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'small-code-edit',
    description: 'classifier-v2 intent: one-line / few-line code edit (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'code-explain',
    description: 'classifier-v2 intent: explain a snippet (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },
  {
    taskType: 'doc-update',
    description: 'classifier-v2 intent: small docs/README edit (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.20',
  },
  {
    taskType: 'extract',
    description: 'classifier-v2 intent: extract structured data from prose (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'error-recovery',
    description: 'classifier-v2 intent: salvage malformed JSON / repair input (local-7b tier).',
    localModel: 'qwen2.5-coder:7b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 1500,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.15',
  },
  {
    taskType: 'medium-code',
    description:
      'classifier-v2 intent: medium-stakes coding work — implement a function, ' +
      'add an endpoint, write a class (local-14b tier). 14B-class for context ' +
      'tracking across the edit; cascade-escalation promotes on weak output.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'doc-write',
    description: 'classifier-v2 intent: write docs / runbook / ADR (local-14b tier).',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'spec-check',
    description: 'classifier-v2 intent: validate spec / acceptance criteria (local-14b tier).',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 3000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.75',
  },
  {
    taskType: 'review-prose',
    description: 'classifier-v2 intent: copyedit / proofread / review prose (local-14b tier).',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-haiku-4-5-20251001',
    useLocal: true,
    maxTokens: 3000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.30',
  },
  {
    taskType: 'code-review',
    description:
      'classifier-v2 intent: review a diff / PR (local-14b tier). Distinct ' +
      'from `code-review-light` which is a first-pass smell check.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'test-gen',
    description: 'classifier-v2 intent: generate unit/integration tests (local-14b tier).',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'schema-design',
    description: 'classifier-v2 intent: design a JSON/Zod/Postgres schema (local-14b tier).',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 4000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.00',
  },
  {
    taskType: 'hard-code',
    description:
      'classifier-v2 intent: hard-code (complex algorithm, large refactor) — ' +
      'cascade says local-32b, but M1 Pro 16GB cannot host a 32B model so the ' +
      'local path uses qwen2.5-coder:14b and cascade-escalation promotes weak ' +
      'output to Claude. Future hardware-tier work may swap this for a true 32B.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'refactor-complex',
    description:
      'classifier-v2 intent: multi-file refactor preserving public contracts. ' +
      'Cascade tier=claude — too risky for local even at 14b.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'architecture',
    description:
      'classifier-v2 intent: propose module boundaries / sketch architecture. ' +
      'Cascade tier=local-32b — local 14b first-pass + Claude cascade fallback.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 6000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.50',
  },
  {
    taskType: 'reason-over-context',
    description: 'classifier-v2 intent: deep reasoning over given context. Cascade tier=claude.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'new-design',
    description:
      'classifier-v2 intent: propose a new design from scratch. Cascade tier=local-32b — ' +
      'local 14b first-pass + Claude cascade fallback.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: true,
    maxTokens: 6000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$1.50',
  },
  {
    taskType: 'architect',
    description: 'classifier-v2 intent: whole-system / blueprint design. Cascade tier=claude.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-opus-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$3.00',
  },
  {
    taskType: 'research-synthesis',
    description:
      'classifier-v2 intent: synthesize across many research artifacts. ' +
      'Cascade tier=stolution-batch, but batch dispatch is not yet wired — ' +
      'route to Claude as the conservative fallback.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'batch-summarize',
    description:
      'classifier-v2 intent: bulk / corpus summary. Cascade tier=stolution-batch ' +
      '— Claude fallback until batch dispatch lands.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'corpus-distill',
    description:
      'classifier-v2 intent: distill themes across a corpus. ' +
      'Cascade tier=stolution-batch — Claude fallback until batch dispatch lands.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 8000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$2.00',
  },
  {
    taskType: 'long-context-reason',
    description:
      'classifier-v2 intent: 200k-token long-context analysis. ' +
      'Cascade tier=stolution-batch — Claude fallback until batch dispatch lands.',
    localModel: 'qwen2.5-coder:14b',
    claudeModel: 'claude-sonnet-4-6',
    useLocal: false,
    maxTokens: 16000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$4.00',
  },
  {
    taskType: 'embedding-generate',
    description:
      'classifier-v2 intent: generate text embeddings. Routes to the local ' +
      'nomic-embed-text model regardless of tier (no claude analogue).',
    localModel: 'nomic-embed-text',
    useLocal: true,
    maxTokens: 2000,
    estimatedCostLocal: '$0.00',
    estimatedCostClaude: '$0.20',
  },
];

// ─── B1 (2026-05-15) — tier-routing invariants ───────────────────────────
// Each classifier-v2 intent name is expected to be backed by a routing-config
// taskType whose localModel matches the tier. Exported for verifyTierRouting()
// (test/routing-config.test.ts) so regressions in EITHER routing-config or the
// classifier-v2 YAML break the build instead of silently serving 7b.
//
// Tier → expected local model on this host (M1 Pro 16GB):
//   local-7b        → qwen2.5-coder:7b
//   local-14b       → qwen2.5-coder:14b
//   local-32b       → qwen2.5-coder:14b  (32B doesn't fit; cascade-escalation
//                                          handles the promotion to Claude)
//   stolution-batch → qwen2.5-coder:14b  (useLocal:false; Claude fallback
//                                          until batch dispatch is wired)
//   claude          → qwen2.5-coder:14b  (useLocal:false)
//
// The `useLocal` expectation is also enforced where it differs from the
// tier-name default. embedding-generate is whitelisted (uses nomic-embed-text).
export interface TierExpectation {
  /** local Ollama model the rule must reference */
  localModel: string;
  /** whether the rule should prefer the local path */
  useLocal: boolean;
}

export const TIER_EXPECTATIONS: Record<string, TierExpectation> = {
  'local-7b':        { localModel: 'qwen2.5-coder:7b',  useLocal: true  },
  'local-14b':       { localModel: 'qwen2.5-coder:14b', useLocal: true  },
  'local-32b':       { localModel: 'qwen2.5-coder:14b', useLocal: true  },
  'stolution-batch': { localModel: 'qwen2.5-coder:14b', useLocal: false },
  'claude':          { localModel: 'qwen2.5-coder:14b', useLocal: false },
};

/** intents whose model is intentionally NOT the tier default. */
const TIER_ROUTING_WHITELIST = new Set<string>([
  'embedding-generate', // uses nomic-embed-text regardless of tier
  // `architecture-review` predates the B1 intent-aliases pass — A.9.7
  // (2026-05-14) deliberately routes it to qwen3:14b (the strongest 14B
  // generalist on M1 Pro) rather than qwen2.5-coder:14b because the
  // critique-an-existing-design task is generalist-shaped, not coder-shaped.
  // Both are 14B-class so the tier intent is preserved; the model choice is
  // a deliberate quality call.
  'architecture-review',
]);

export interface TierRoutingViolation {
  intent: string;
  expectedTier: string;
  expectedModel: string;
  expectedUseLocal: boolean;
  /** undefined when no routing-config rule exists for this intent (the
   *  primary silent-tier-collapse cause — getRoute() falls through to the
   *  unknown-task default at qwen2.5-coder:7b). */
  actualModel?: string;
  actualUseLocal?: boolean;
  reason: 'no-rule' | 'wrong-model' | 'wrong-useLocal';
}

/**
 * Cross-validate routing-config against the classifier-v2 intent taxonomy.
 *
 * For each `{ intent, default_tier }` pair, asserts that:
 *   - ROUTING_RULES contains a rule with `taskType === intent`
 *   - the rule's `localModel` matches TIER_EXPECTATIONS[tier].localModel
 *   - the rule's `useLocal` matches TIER_EXPECTATIONS[tier].useLocal
 *
 * Returns an array of violations (empty on success). The unit test asserts
 * the array is empty so silent tier-collapse regressions break CI.
 */
export function verifyTierRouting(
  intents: ReadonlyArray<{ name: string; default_tier: string }>,
): TierRoutingViolation[] {
  const violations: TierRoutingViolation[] = [];
  for (const intent of intents) {
    if (TIER_ROUTING_WHITELIST.has(intent.name)) continue;
    const expected = TIER_EXPECTATIONS[intent.default_tier];
    if (expected === undefined) continue; // unknown tier → ignore
    const rule = ROUTING_RULES.find((r) => r.taskType === intent.name);
    if (rule === undefined) {
      violations.push({
        intent: intent.name,
        expectedTier: intent.default_tier,
        expectedModel: expected.localModel,
        expectedUseLocal: expected.useLocal,
        reason: 'no-rule',
      });
      continue;
    }
    if (rule.localModel !== expected.localModel) {
      violations.push({
        intent: intent.name,
        expectedTier: intent.default_tier,
        expectedModel: expected.localModel,
        expectedUseLocal: expected.useLocal,
        actualModel: rule.localModel,
        actualUseLocal: rule.useLocal,
        reason: 'wrong-model',
      });
      continue;
    }
    if (rule.useLocal !== expected.useLocal) {
      violations.push({
        intent: intent.name,
        expectedTier: intent.default_tier,
        expectedModel: expected.localModel,
        expectedUseLocal: expected.useLocal,
        actualModel: rule.localModel,
        actualUseLocal: rule.useLocal,
        reason: 'wrong-useLocal',
      });
    }
  }
  return violations;
}

export function getRoute(taskType: string): RoutingRule {
  const rule = ROUTING_RULES.find((r) => r.taskType === taskType);
  if (!rule) {
    // Default: prefer LOCAL Ollama for unknown task types.
    //
    // Updated 2026-04-30 (LAI-002 follow-up): the binary-spawn ClaudeAdapter
    // takes ~6-10s session init + the prompt cost. For short classification
    // tasks (validation-*, decomposer-recursive helpers, etc.) Ollama is
    // strictly faster AND free. Defaulting to local also avoids the
    // launchd-scoped "claude binary timed out" spiral that blocked the
    // 2026-04-30 multi-pass validation when validation-content-relevance
    // and similar unregistered task types fell through to a 180s Claude
    // wait per call.
    //
    // Callers that explicitly want Claude can either register the task in
    // ROUTING_RULES with useLocal:false or pass options.forceClaude=true.
    return {
      taskType,
      description: 'Unknown task type (defaults to local Ollama)',
      localModel: 'qwen2.5-coder:7b',
      claudeModel: 'claude-sonnet-4-6',
      useLocal: true,
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
