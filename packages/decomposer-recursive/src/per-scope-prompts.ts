/**
 * Per-scope decomposition prompts (proposal §6).
 *
 * Each prompt is a system-level instruction that grounds the LLM in
 * the scope's PMBOK/SAFe/DDD/INVEST invariants, asks it to emit a
 * children array conforming to ChildTicketArraySchema, and includes
 * the FREG/AKG substrate hints in the user message.
 *
 * Prompts are deliberately compact (~600-800 system + ~1.5-3K user
 * tokens — see proposal §10 cost model). They reference the JSON
 * envelope from structured-output.ts; they do NOT redeclare the
 * "return JSON only" instruction.
 */

import type { StoryScope } from './types.js';

const SHARED_INVARIANTS = `Universal invariants (apply at every scope):
- 100% rule (PMBOK): the union of children must cover the parent's inScope. List anything you intentionally omit under outOfScope.
- MECE: no two children may overlap in deliverable scope. If you find yourself describing the same feature in two children, merge them.
- Honest ambiguity: if the prompt under-specifies persona, KPI, or boundary, emit a child with a low confidence score and call it out in the description; never invent KPIs the user didn't imply.
- Cite-evidence: every claim about user intent must reference parent-ticket text.
- Existing substrate: when an EXISTING FEATURES (FREG) or EXISTING ARCHITECTURE (AKG) entry overlaps a child's scope, set lifecycle='enhance' and reference the artifact id; prefer reuse over re-create.
- IDs: child IDs must be unique strings within the children array; no self-dependencies.
`;

const INITIATIVE_PROMPT = `You are decomposing a strategic initiative into epics. An initiative is a multi-quarter strategic bet at the portfolio level. An epic is a single program-increment-sized (8-12 weeks per SAFe) chunk of value with one elevator-pitch theme.

Your job: read the initiative ticket and produce 2-5 epics that, taken together, fully deliver the initiative's businessOutcome and respect the initiative's outOfScope.

Strict requirements:
1. Coverage + Disjointness as in the universal invariants.
2. Each epic must have its own elevator-pitch summary (<= 25 words) in title+description.
3. Each epic's inScope[] should have 3-6 items (each >= 5 words); outOfScope[] should have 1-3 items.
4. Each epic must declare 1-2 dominant tech_sub_domains in the description ("dominant tech: ui+backend").
5. Cross-epic dependencies: declare a dependency edge in dependencies[] if epic-A blocks epic-B; no self-dependencies.
6. Each epic's lifecycle: 'enhance' if the FREG/AKG context shows substantial overlap with an existing feature; else 'new'. P0 stubs FREG/AKG to empty so default is 'new'.

${SHARED_INVARIANTS}`;

const EPIC_PROMPT = `You are decomposing an epic into modules. A module is a Domain-Driven-Design bounded context — a coherent capability cluster with a single primary tech_sub_domain and its own data ownership.

Produce 2-6 modules that fully deliver the epic and respect the epic's outOfScope.

Vertical-slicing reminder: if an epic touches UI, backend, and DB, prefer modules sliced by user-visible feature (each touching all three layers thinly) over modules sliced by technical layer.

Strict requirements:
1. Coverage + Disjointness.
2. Each module declares its primary tech_sub_domain in the description ("primary tech: backend").
3. Each module declares its data ownership in inScope[] (which schemas/tables/state-stores it owns).
4. Cross-module dependencies declared explicitly. Most modules depend on at least one other.

${SHARED_INVARIANTS}`;

const MODULE_PROMPT = `You are decomposing a module into stories. A story is an INVEST-compliant user-value increment.

Produce 2-8 stories that fully deliver the module's user-visible value.

Strict requirements:
1. Coverage + Disjointness.
2. Each story has a "As a [persona], I want [outcome] so that [value]" sentence in description.
3. Each story has acceptanceCriteria with 3-6 concrete items (each >= 8 words, each testable).
4. Each story has its own inScope[] / outOfScope[].
5. Vertical slice preferred when user value crosses tech sub-domains.

${SHARED_INVARIANTS}`;

const STORY_PROMPT = `You are decomposing a story into tasks. A task is a single-concern, <= 1-day, single-tech-sub-domain unit of work — typically a single file or tightly-coupled file group.

Produce 1-6 tasks that fully implement the story's acceptance criteria.

Strict requirements:
1. Each task corresponds to >= 1 AC of the parent story (mention which AC IDs in the description).
2. Each task has a concrete artifact target: file path, function/class name, schema/migration name, or API route in description.
3. Each task declares its tech_sub_domain (single primary value) in the description.
4. Cross-task dependencies declared in dependencies[] (data-model task blocks API task blocks UI task).

${SHARED_INVARIANTS}`;

const TASK_PROMPT = `You are decomposing a task into subtasks. A subtask is a single mechanical step: single function, single test, single comment block, single config edit.

Most tasks do NOT need subtask decomposition. Produce 2-5 subtasks only when the parent task is genuinely multi-step (multi-file refactor, multi-test test addition).

Strict requirements:
1. Each subtask is <= 2 hours of work for a competent engineer.
2. Each subtask names the precise artifact (function name, test name, file region) in the description.
3. Subtasks are typically sequential within a task; declare order via dependencies[].

${SHARED_INVARIANTS}`;

const SUBTASK_PROMPT = `You are at the atomicity floor. Subtasks are leaves and rarely decompose further.

If you absolutely must produce children (e.g., a renamed-as-subtask actually being a multi-step refactor), produce 2-3 micro-steps. Each micro-step is a single file edit or single line change.

${SHARED_INVARIANTS}`;

/**
 * Map from parent scope to the system prompt for decomposing it into
 * its child scope. Note: the key is the PARENT scope. The child scope
 * is one level below per STORY_SCOPE_ORDER.
 */
export const DECOMPOSER_SYSTEM_PROMPTS: Record<StoryScope, string> = {
  initiative: INITIATIVE_PROMPT,
  epic: EPIC_PROMPT,
  module: MODULE_PROMPT,
  story: STORY_PROMPT,
  task: TASK_PROMPT,
  subtask: SUBTASK_PROMPT,
};

/**
 * Map from parent scope to the routing-rule task type. Used by the
 * engine to route through @chiefaia/local-llm-router with the right
 * cost/quality tier.
 */
export const DECOMPOSER_TASK_TYPES: Record<StoryScope, string> = {
  initiative: 'po-decomposer-initiative',
  epic: 'po-decomposer-epic',
  module: 'po-decomposer-module',
  story: 'po-decomposer-story',
  task: 'po-decomposer-task',
  subtask: 'po-decomposer-subtask',
};

/**
 * Child-scope mapping. `subtask` has no child (it's the atomicity floor);
 * the engine never asks for sub-subtasks.
 */
export const CHILD_SCOPE_OF: Record<StoryScope, StoryScope | null> = {
  initiative: 'epic',
  epic: 'module',
  module: 'story',
  story: 'task',
  task: 'subtask',
  subtask: null,
};
