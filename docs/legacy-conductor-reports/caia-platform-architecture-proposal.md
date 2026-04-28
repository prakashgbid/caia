# CAIA Platform: Comprehensive Architecture Proposal

**Document Status:** Draft v1.0  
**Author:** Synthesized from codebase audit + platform vision  
**Date:** April 27, 2026  
**Repository:** `github.com/prakashgbid/caia`  
**Predecessor:** `github.com/prakashgbid/conductor` (archived 2026-04-25, consolidated into CAIA monorepo)

---

## Executive Summary

CAIA (Chief AI Agent) is an opinionated, AI-native software factory: a platform that accepts a natural-language requirement and produces a running, deployed, tested feature with minimal human involvement. This document provides the canonical architecture reference for the full platform — from terminology definitions through implementation phases — grounded in an audit of the existing `conductor` codebase that has been consolidated into the CAIA monorepo.

The platform is meaningfully more built than most "AI coding agent" projects: a real event bus with SQLite persistence exists, a working executor that spawns `claude --print` in git worktrees exists, a priority scoring engine exists, health-check infrastructure (pipeline-pulse) exists, and a Next.js dashboard with ~20 route pages exists. The gaps are specific and closeable: a true multi-level AI decomposer, a PR/merge pipeline, deployment integration, a human acceptance gate, and local LLM routing are the primary missing pieces.

The recommendation is to treat the existing codebase as a solid foundation, not a rewrite candidate. The architecture described here extends and formalises what exists.

---

## Table of Contents

1. [Vision Clarification & Terminology](#section-1-vision-clarification--terminology)
2. [Current State Audit](#section-2-current-state-audit)
3. [Full Pipeline Architecture](#section-3-full-pipeline-architecture)
4. [Utility Catalogue](#section-4-utility-catalogue)
5. [Dashboard Specification](#section-5-dashboard-specification)
6. [Technology Stack Decisions](#section-6-technology-stack-decisions)
7. [Local LLM Strategy](#section-7-local-llm-strategy)
8. [Gap Analysis — Vision vs Current State](#section-8-gap-analysis--vision-vs-current-state)
9. [Implementation Phases](#section-9-implementation-phases)
10. [Open Source Strategy](#section-10-open-source-strategy)

---

## Section 1: Vision Clarification & Terminology

### 1.1 The Canonical Hierarchy

CAIA decomposes human intent into a strict six-level hierarchy. Each level has a precise definition, scope, and decomposition trigger. Every node in this hierarchy is stored in the `stories` table with a `kind` discriminant; the schema already supports this model.

#### Level 0 — Prompt (root)

A **Prompt** is the raw user input that initiates a pipeline run. It is a natural-language description of an intent, not yet structured. Prompts are stored in the `prompts` table and given a `correlation_id` that flows through every downstream entity for full lineage tracing.

- **Scope:** one user submission
- **Examples:** "Add a dark mode toggle to the settings page", "Build a Stripe billing integration with seat-based pricing"
- **Lifecycle:** `received → analyzing → decomposed → answered | failed`
- **Decomposition trigger:** successful ingestion + optional clarification round-trip

#### Level 1 — Initiative

An **Initiative** is the highest-level strategic grouping of work. It maps to a product milestone or capability area. A single Prompt typically produces one Initiative; a complex Prompt may produce multiple if it spans unrelated domains.

- **Scope:** weeks to months of work; multiple teams in a human organization
- **Decomposition criteria:** the requirement is too large to estimate or execute as a single unit; it has multiple independent value-delivery moments
- **Examples:** "Billing & Subscription System", "Authentication & User Management", "Real-time Collaboration Features"
- **Max size heuristic:** more than 5 Epics

#### Level 2 — Epic

An **Epic** is a coherent slice of an Initiative that delivers a discrete, user-visible or system-observable capability. It must be independently deployable to staging for human review.

- **Scope:** days to 1–2 weeks of AI execution
- **Decomposition criteria:** the Epic has more than 3 Modules, or its acceptance criteria span more than one deployment target
- **Examples:** "Stripe Customer Portal Integration", "JWT Authentication Middleware", "WebSocket Presence System"
- **Max size heuristic:** 3–6 Modules; if more, split the Epic

#### Level 3 — Module

A **Module** is a self-contained functional block within an Epic — typically one backend service, one frontend feature section, or one infrastructure component. A Module maps to a named domain in the `domains` table.

- **Scope:** hours to 1 day of AI execution
- **Decomposition criteria:** the Module's implementation touches more than 2 distinct layers (e.g. DB + API + UI) or more than ~10 files
- **Examples:** "Stripe Webhook Handler", "Subscription Status UI Component", "Billing Database Schema"
- **Max size heuristic:** 3–8 Stories

#### Level 4 — Story

A **Story** is an atomic, implementable unit of work that can be assigned to a single AI coding agent session. It has explicit acceptance criteria and a verification plan. This is the primary unit that the executor dispatches.

- **Scope:** 20 minutes to 2 hours of AI execution; typically 1–8 files changed
- **Decomposition criteria:** if a Story requires more than 8 file changes, or more than 2 tool capability types (e.g. both DB schema change and E2E test writing), it should be split
- **Examples:** "Create `webhook_events` table migration", "Implement `POST /webhooks/stripe` route with signature verification", "Add SubscriptionBadge component to Profile page"
- **Must have:** at least 1 verifiable acceptance criterion, at least 1 verification plan step

#### Level 5 — Task

A **Task** is an implementation step within a Story, typically corresponding to one git commit's worth of work. Tasks are auto-generated by the executing agent during Story execution and tracked via the `task_subtasks` table.

- **Scope:** 5–30 minutes; typically 1–3 files
- **Examples:** "Create migration file `0042_stripe_events.sql`", "Write unit tests for signature verification", "Add `useSubscription` hook"
- **Note:** Tasks are usually generated autonomously by the agent, not pre-planned by the decomposer

#### Level 6 — Subtask

A **Subtask** is a granular action within a Task — a single tool call cluster or one discrete operation. Subtasks are ephemeral: they live in the `task_subtasks` table during execution but are not persisted as independent entities after completion. They are used for real-time execution visibility.

- **Scope:** seconds to minutes; one logical action
- **Examples:** "Run `npx drizzle-kit generate`", "Write function `verifyStripeSignature`", "Run `vitest run src/webhooks`"

---

### 1.2 Hierarchy Decomposition Criteria Summary

| Level | Created By | Typical Duration | Files Touched | Human-Visible Result |
|-------|-----------|-----------------|---------------|---------------------|
| Prompt | Human | N/A | N/A | Submission |
| Initiative | AI Decomposer | Weeks | Hundreds | Product milestone |
| Epic | AI Decomposer | Days | 30–100 | Deployable feature |
| Module | AI Decomposer | Hours | 10–30 | Domain subsystem |
| Story | AI Decomposer | 20min–2h | 1–8 | Verifiable change |
| Task | Executing Agent | 5–30min | 1–3 | Git commit |
| Subtask | Executing Agent | Seconds | 1 | Tool call |

---

### 1.3 Pipeline Stage Definitions

A **pipeline stage** is a named, observable state that a Prompt passes through from submission to production release. Each stage has explicit entry/exit criteria, emits events, and is tracked in the `prompt_pipeline_stages` table.

| Stage | Entry Criteria | Exit Criteria |
|-------|---------------|--------------|
| `ingested` | POST /prompts received | Prompt written to DB, `prompt.ingested` event emitted |
| `clarifying` | Ambiguity detected by AI | All clarification questions answered by user |
| `decomposing` | Clarification complete (or skipped) | Full hierarchy tree written to `stories` table |
| `enriching` | Decomposition complete | All Stories have acceptance criteria + verification plans |
| `scheduling` | Enrichment complete | DAG computed, all Stories assigned buckets + ordinals |
| `executing` | At least one Story is queued | All Stories in terminal state |
| `pr_open` | First Story completed | PR created against main branch |
| `testing` | PR created | All tests passing in CI |
| `build_verified` | Tests pass | Local/CI build exits 0 |
| `staging_deployed` | Build verified | Feature visible at staging URL |
| `human_review` | Staging deployed | Human approves or rejects |
| `released` | Human approves | Merged to main, production deployed |
| `closed` | Production deployed | All events closed, metrics captured |

---

### 1.4 The Utility / Module / Plugin Model

**Utility:** A single-responsibility process or library with a defined input type, output type, and event contract. A utility has no knowledge of other utilities. It reads from and writes to the event bus, the API, or both. Examples: `@caia/decomposer`, `@caia/scheduler`, `@caia/executor`.

**Module (platform sense, not hierarchy sense):** A combination of two or more utilities that together implement a pipeline stage. A Module has its own configuration surface and lifecycle (start, stop, health). Example: The "Execution Module" combines the Scheduler, the Executor, the Worktree Manager, and the Circuit Breaker.

**Plugin:** A distributable bundle of one or more utilities + configuration that extends CAIA for a specific domain. Plugins are installed via the Claude Code / Cowork plugin registry. Example: `caia-plugin-cloudflare` adds the Cloudflare deployment utility and a dashboard panel. Plugins declare their event subscriptions and API routes in a manifest.

---

## Section 2: Current State Audit

### 2.1 What Exists (Confirmed by Codebase Inspection)

The following components were verified by reading source files in `~/Documents/projects/conductor/` (now consolidated into the CAIA monorepo).

#### Core Infrastructure

**Event Bus** (`packages/event-bus/index.ts`)  
Fully implemented. Uses Node.js `EventEmitter` with picomatch glob subscriptions. Dual-path: in-process emit + SQLite persistence via an injected `EventDb` interface. Supports replay, correlation IDs, causation IDs, OpenTelemetry trace/span IDs. The `events` table (migration 0008) stores all events. The bus is wired at startup via `src/events/bus-adapter.ts`. **Status: Production-ready.**

**Events Taxonomy** (`packages/events-taxonomy/index.ts` + `registry.yaml`)  
Fully implemented. Canonical TypeScript types for all event types, actors, payloads, and severity levels. Covers: pipeline, story, task, executor, worker, behavior-test, completeness, backup, user, system, prompt events. **Status: Production-ready; extend as new stages are added.**

**Database** (`src/db/schema.ts`, 15 migrations)  
SQLite via Drizzle ORM. The schema is comprehensive: `projects`, `requirements`, `tasks`, `stories`, `blockers`, `questions`, `events`, `task_runs`, `executor_runs`, `build_runs`, `behavior_tests`, `completeness_runs`, `prompts`, `prompt_pipeline_stages`, `priority_audit`, `pulse_runs`. The `stories` table already supports the full hierarchy (`kind` ∈ `epic|story|sub_story|task|sub_task|todo`). **Status: Solid; needs `initiatives` support added to `kind` enum and migration.**

**Logger** (`packages/logger/index.ts`)  
Implemented. Pino-based structured logger. **Status: Production-ready.**

**Test Kit** (`packages/test-kit/index.ts`)  
Implemented. Test utilities and mocks for the event bus and DB. **Status: Usable; extend as new utilities are added.**

#### API Layer

**Hono API Server** (`src/api/app.ts`, `src/api/routes/`)  
Implemented. 20+ route files:
- `prompts.ts` — prompt CRUD, pipeline visualization, journey view, events by correlation_id
- `stories.ts` — full story tree CRUD with revision history
- `tasks.ts` (inferred from schema) — task lifecycle
- `executor.ts` — executor config, runs, task status transitions
- `events.ts` — event query and replay
- `pulse.ts` — health check runs
- `builds.ts` — build run tracking
- `behavior-tests.ts` — behavioral test registry
- `timeline.ts` — timeline events
- `priority.ts` — priority scoring and bucket assignment
- `features.ts`, `adrs.ts`, `audit.ts`, `domains.ts`, `suggestions.ts`, `metrics.ts`, `legacy.ts`

**Status: Comprehensive. Missing: `/decompose`, `/clarify`, `/deploy`, `/accept` routes.**

#### Execution Pipeline

**Executor Daemon** (`apps/executor/executor-daemon.ts`)  
Fully implemented. Poll-based daemon: every `pollIntervalMs` it runs a scheduler → dispatcher → monitor cycle. Supports:
- Configurable concurrency (`maxConcurrent`, `maxPerDomainConcurrent`)
- Circuit breaker (`circuitBreakerThreshold`)
- Git worktree lifecycle per task (create on dispatch, cleanup on completion)
- `claude --print --output-format json --permission-mode bypassPermissions` invocation
- Tiered model routing: Haiku for canary/trivial, Sonnet default, Opus for architecture keywords
- PID-based crash recovery on restart
- Drain mode (EXECUTOR_DRAIN_LIMIT)

**Status: Functional and production-grade. Missing: streaming output to dashboard in real-time.**

**Dispatcher** (`apps/executor/dispatcher.ts`)  
Fully implemented. Creates git worktrees, builds prompts, spawns `claude -p`, captures output lines, parses `[result] DONE/FAILED` markers and JSON cost/turn metadata. Registers executor runs in the DB. **Status: Production-ready.**

**Scheduler** (`apps/executor/scheduler.ts`)  
Implemented (inferred from daemon usage). Enforces `maxConcurrent`, `maxPerDomainConcurrent`, dependency ordering (via `dependsOn`). **Status: Functional; could benefit from true DAG topological sort.**

**Priority Scoring** (`src/prioritization/scorer.ts`, `bucketer.ts`, `placer.ts`, `reprioritizer.ts`)  
Fully implemented. Composite 0-100 scorer with 7 weighted dimensions: urgency (25%), blast_radius (20%), user_visible (15%), risk_if_delayed (15%), domain_criticality (15%), confidence (10%), effort_inverse (10%). Assigns to buckets P0–P3. Subscribes to events for automatic re-prioritization. **Status: Production-ready.**

**Pump Engine** (`src/pump/index.ts`)  
Implemented. The legacy dispatch loop for `requirements` (pre-task model): selects eligible requirements by priority bucket + file-overlap conflict detection, builds prompts, transitions state. **Status: Legacy path; superseded by the executor daemon for task-level execution. Retain for requirement-level orchestration.**

#### Decomposition (Partial)

**Story Backfiller** (`apps/story-backfiller/index.ts`)  
Partially implemented. A daily cron that scans requirements with no story decomposition and creates a single `epic` node for each. This is a stub — it creates a one-level tree (just an Epic) with boilerplate acceptance criteria. It does **not** perform AI decomposition into Module→Story→Task levels. **Status: Placeholder. The real AI decomposer is the #1 missing piece.**

#### Quality & Observability

**Pipeline Pulse** (`apps/pipeline-pulse/src/pulse.ts`)  
Fully implemented. Three-layer health check: synthetic canary (dispatches a real Haiku task), state-checksum invariants, and 15 micro-probes in parallel. Auto-heals on known failure signatures. Outcomes: PASSING | DEGRADED | CRITICAL | AUTO-HEALED. **Status: Production-ready.**

**Completeness Sentinel** (`apps/completeness-sentinel/`)  
Implemented (daemon in a separate plugin directory `~/Documents/projects/plugins/completeness-sentinel/`). Runs completeness checks on entities: `file_exists`, `url_200`, `test_pass`, `commit_sha`, `behavior_test`. Stores findings in `completeness_runs` + `completeness_findings`. **Status: Production-ready.**

**Orchestrator Middleware** (`apps/orchestrator-middleware/src/`)  
Fully implemented. Enforces: TRACE-001 (prompt ordering), TASK-001 (task_run acknowledgement TTL), AUTON-001/002/006/007/008 (banned phrases in outbound messages — prevents agents from saying things like "I'll just...", "simply", etc. that indicate autonomy bypass). **Status: Production-ready for single-agent use; extend for multi-agent orchestration.**

#### Dashboard

**Next.js Dashboard** (`dashboard/`)  
Partially implemented. 20+ route directories exist: `timeline`, `prompts`, `tasks`, `stories`, `queue`, `pipeline`, `events`, `builds`, `tests`, `observability`, `requirements`, `blockers`, `questions`, `features`, `adrs`, `domains`, `settings`, `reports`, `coverage`, `audit`. Components include: `TimelineFeed`, `TaskTable`, `RequirementsKanban`, `BlockersKanban`, `DagView`, `EventLog`, `HealthPanel`, `MetricsDashboard`, `FileHeatMap`. **Status: Substantial but incomplete. Most views exist in skeleton or minimal form; the prompt-to-pipeline waterfall drill-down is missing.**

---

### 2.2 What Is Missing (Gaps)

1. **AI Hierarchy Decomposer** — The most critical gap. No component uses Claude to decompose a Prompt into the full Initiative→Epic→Module→Story tree with enriched acceptance criteria.
2. **Requirement Clarifier** — The `questions` table and `QuestionsKanban` UI exist, but there is no AI agent that proactively generates and asks clarifying questions before decomposition.
3. **PR Creator & Manager** — No component creates GitHub PRs, runs reviews, or manages merge state.
4. **Deployment Manager** — No component triggers Cloudflare Pages or GCP deployments.
5. **Human Acceptance Gate** — No structured flow for a user to review staging, approve, and trigger production release.
6. **Release Manager** — No component handles the merge → production deploy → observability-closeout flow.
7. **Full Build Verification** — The `build_runs` table and schema exist; a `build-runner.sh` script is referenced in `package.json`; but the build verifier is not integrated into the pipeline as an automatic step.
8. **Test Runner Integration** — Behavior tests are tracked in the DB; there is a `behavior-runner` actor in the taxonomy; but no daemon automatically runs the test suite after task completion.
9. **Streaming Execution Output** — The executor captures `outputLines` from `claude --print` but there is no mechanism to stream these line-by-line to the dashboard in real-time.
10. **Local LLM Router** — Model selection exists (`selectModel()` in `dispatcher.ts`), but only routes between Claude models. No Ollama/local LLM integration.
11. **Initiative-level hierarchy node** — The `stories` table `kind` enum does not include `initiative`. The decomposer will need this.
12. **DAG Dependency Analyzer** — `dependsOn` fields exist on both `stories` and `tasks`, but no utility builds the full directed acyclic graph, validates it for cycles, or computes the critical path.

---

## Section 3: Full Pipeline Architecture

Each stage is defined with its complete contract. The `current_status` field reflects the April 2026 codebase state.

---

### Stage 1: Prompt Ingestion

**Name:** `prompt.ingestion`  
**Purpose:** Accept and durably record a user's raw requirement text; assign a correlation ID; begin lineage tracking.

**Input Contract:**
```typescript
interface PromptIngestionInput {
  body: string;           // raw requirement text, 10–10,000 chars
  receivedVia: 'chat' | 'api' | 'cli' | 'scheduled-task';
  userId?: string;
  sessionId?: string;
  metadata?: {
    projectId?: string;   // target project slug
    labels?: string[];
    priority?: 'p0' | 'p1' | 'p2' | 'p3';
  };
}
```

**Output Contract:**
```typescript
interface PromptIngestionOutput {
  promptId: string;        // e.g. "prm_abc123"
  correlationId: string;   // UUID flowing through all descendants
  hash: string;            // sha256 of body — used for idempotency (10s window)
  status: 'received';
}
```

**Trigger:** HTTP POST `/prompts` or dashboard form submission.  
**Events Emitted:** `prompt.ingested` (actor: `api`)  
**AI Involvement:** None.  
**Human Touchpoints:** The user submits the prompt. No other human involvement at this stage.  
**Current Status:** ✅ **Fully implemented.** `src/api/routes/prompts.ts` implements the POST endpoint; `src/prompts/manager.ts` handles creation with hash deduplication; pipeline stage `ingested` is inserted; `prompt.ingested` event is published.

---

### Stage 2: Requirement Clarification

**Name:** `prompt.clarification`  
**Purpose:** Use AI to detect ambiguity, missing context, or contradictions in the prompt; surface targeted questions; wait for user answers before proceeding to decomposition.

**Input Contract:**
```typescript
interface ClarificationInput {
  promptId: string;
  promptBody: string;
  projectContext: {
    techStack: string[];      // e.g. ["Next.js", "Cloudflare Pages", "SQLite/Drizzle"]
    existingDomains: string[];
    recentChanges: string[];  // last 5 merged PRs
  };
}
```

**Output Contract:**
```typescript
interface ClarificationOutput {
  questions: Array<{
    id: string;
    priority: 'critical' | 'normal' | 'optional';
    text: string;
    recommendations: string[];  // suggested answers
    customAnswerPlaceholder?: string;
  }>;
  clarityScore: number;  // 0-1; if > 0.85, skip clarification
  canSkip: boolean;
}
```

**Trigger:** Automatic after `prompt.ingested` event if `clarityScore < 0.85`.  
**Events Emitted:** `prompt.clarification_started`, `prompt.clarification_completed`  
**AI Involvement:** Claude Haiku — fast, cheap. Prompt: analyze the requirement against the project's tech stack and recent history, produce up to 5 targeted questions. System prompt includes project context, domain taxonomy, and example good/bad requirements.  
**Human Touchpoints:** User answers questions in the dashboard. Questions with `priority: 'optional'` can be skipped.  
**Current Status:** ⚠️ **Partial.** The `questions` table, state machine (`src/questions/`), and `QuestionsKanban` UI exist. The AI clarifier agent that generates questions from a prompt does **not** exist. The `questions` system was designed for agent-generated questions during execution, not pre-decomposition clarification. Needs: a `@caia/clarifier` utility.

---

### Stage 3: Hierarchy Decomposition

**Name:** `prompt.decomposition`  
**Purpose:** Use AI to decompose the (clarified) requirement into the full Initiative→Epic→Module→Story tree; write all nodes to the `stories` table with parent linkage; ensure every Story has title, description, and estimated files.

**Input Contract:**
```typescript
interface DecompositionInput {
  promptId: string;
  promptBody: string;
  clarificationAnswers: Record<string, string>;  // questionId → answer
  projectContext: {
    techStack: string[];
    domains: Domain[];
    lockContracts: LockContract[];  // design standards, brand rules, etc.
    recentStories: Story[];         // last 20 completed stories for style reference
  };
  maxDepth: 'initiative' | 'epic' | 'module' | 'story';  // configurable; default 'story'
}
```

**Output Contract:**
```typescript
interface DecompositionOutput {
  rootInitiativeId: string;
  treeNodeCount: number;
  storyCount: number;     // leaf stories ready for enrichment
  durationMs: number;
  tokenUsage: { input: number; output: number };
}
// Side effect: all nodes written to `stories` table with rootPromptId linkage
```

**Trigger:** `prompt.clarification_completed` event (or `prompt.ingested` if clarification is skipped).  
**Events Emitted:** `pipeline.decompose_started`, `pipeline.decompose_completed`, `story.created` (per node)  
**AI Involvement:** Claude Sonnet — balanced quality/cost for structured output. Two-phase approach:
1. **Phase 1 (Sonnet):** Produce the Initiative + Epics + Modules in a single structured JSON response. Prompt: "Given this requirement and project context, produce a complete hierarchical decomposition. Output JSON conforming to DecompositionTree schema. Think step by step about dependencies before outputting."
2. **Phase 2 (parallel Sonnet calls, one per Module):** Produce Stories for each Module. This parallelism is the key to fast decomposition.  

Structured output (JSON mode) is mandatory to ensure parseable responses. Each Story must include: `title`, `description`, `expectedBehavior`, `acceptanceCriteria[]`, `verificationPlan[]`, `estimatedFiles[]`, `dependsOn[]`, `domainSlug`.

**Human Touchpoints:** Optional. If `storyCount > 50` or the decomposition confidence is low, present the tree to the user for a "looks right?" confirmation before proceeding to execution.  
**Current Status:** ❌ **Missing.** The `story-backfiller` is a stub that creates a single flat Epic node with boilerplate criteria. The real multi-level AI decomposer is the platform's most critical missing piece.

---

### Stage 4: Task Enrichment

**Name:** `story.enrichment`  
**Purpose:** For each leaf Story, use AI to generate detailed implementation specifications: exact file paths, function signatures, test cases, implementation notes. Enrichment turns a Story title into an actionable engineering brief.

**Input Contract:**
```typescript
interface EnrichmentInput {
  storyId: string;
  story: {
    title: string;
    description: string;
    acceptanceCriteria: string[];
    estimatedFiles: string[];
    domainSlug: string;
  };
  projectContext: {
    existingFileTree: string;  // relevant subtree
    lockContracts: LockContract[];
    relatedStories: Story[];   // sibling stories in same Module
  };
}
```

**Output Contract:**
```typescript
interface EnrichmentOutput {
  storyId: string;
  enrichedSpec: {
    implementationNotes: string;
    fileChanges: Array<{
      path: string;
      operation: 'create' | 'modify' | 'delete';
      description: string;
    }>;
    testCases: string[];
    dependenciesRequired: string[];  // npm packages, etc.
    estimatedComplexity: 'trivial' | 'simple' | 'moderate' | 'complex';
    recommendedModel: 'haiku' | 'sonnet' | 'opus' | 'local';
  };
}
```

**Trigger:** `pipeline.decompose_completed` event; all Stories enriched in parallel.  
**Events Emitted:** `story.updated` (fields: enriched_spec)  
**AI Involvement:** Claude Haiku for trivial/simple stories; Sonnet for moderate/complex. System prompt includes project file tree, code style examples, and lock contracts. The enricher's primary value is mapping abstract story descriptions to concrete file paths and function signatures that the executing agent will actually use.  
**Human Touchpoints:** None in the automated path. Users can edit enrichment via the dashboard before execution begins.  
**Current Status:** ❌ **Missing.** Stories are currently created with minimal metadata. No enrichment utility exists.

---

### Stage 5: Dependency Analysis

**Name:** `story.dependency_analysis`  
**Purpose:** Build the directed acyclic graph (DAG) of Story dependencies; validate for cycles; identify the critical path; classify Stories as `sequential` (blocked by a predecessor) or `parallel` (can execute concurrently).

**Input Contract:**
```typescript
interface DependencyAnalysisInput {
  promptId: string;
  stories: Array<{
    id: string;
    dependsOn: string[];      // explicit story IDs
    estimatedFiles: string[]; // for implicit file-overlap detection
    domainSlug: string;
    estimatedComplexity: string;
  }>;
}
```

**Output Contract:**
```typescript
interface DependencyAnalysisOutput {
  dag: {
    nodes: string[];
    edges: Array<{ from: string; to: string; kind: 'explicit' | 'file_overlap' | 'domain_sequence' }>;
  };
  criticalPath: string[];          // ordered list of story IDs on longest path
  parallelBatches: string[][];     // topological levels: batch[0] can all start at once, etc.
  cyclesDetected: Array<string[]>; // should be empty; pipeline halts if not
  estimatedWallClockMs: number;    // if all parallel batches run at max concurrency
}
```

**Trigger:** `story.enrichment_completed` (all Stories enriched for a prompt).  
**Events Emitted:** `pipeline.dag_computed`  
**AI Involvement:** None for DAG construction (pure graph algorithm). Optional: Claude Haiku for detecting semantic dependencies that aren't expressed in explicit `dependsOn` fields — e.g. "Story B modifies a schema that Story A also reads" even if B doesn't list A in `dependsOn`.  
**Human Touchpoints:** The DAG is visualized in the dashboard (`DagView` component already exists). Users can add or remove edges before scheduling begins.  
**Current Status:** ⚠️ **Partial.** `dependsOn` fields exist on `stories` and `tasks`. The scheduler uses `dependsOn` for task-level sequencing. No utility builds the full cross-story DAG, validates it, or computes parallel batches. The `DagView` component exists in the dashboard but may not have full data to render.

---

### Stage 6: Scheduling

**Name:** `story.scheduling`  
**Purpose:** Assign each Story a priority bucket (P0–P3), position ordinal within its bucket, and execution slot (sequential batch number). Feed the result to the executor queue.

**Input Contract:**
```typescript
interface SchedulingInput {
  promptId: string;
  dag: DependencyAnalysisOutput;
  stories: Array<{
    id: string;
    domainSlug: string;
    estimatedComplexity: string;
    userPriority?: number;  // explicit override from metadata
  }>;
  executorConfig: {
    maxConcurrent: number;
    maxPerDomainConcurrent: number;
  };
}
```

**Output Contract:**
```typescript
// Side effect: all Stories have tasks created in the `tasks` table with
// priorityBucket, positionOrdinal, dependsOn set correctly.
interface SchedulingOutput {
  tasksCreated: number;
  estimatedStartOrder: Array<{ taskId: string; batchN: number; canStartAt: string }>;
}
```

**Trigger:** `pipeline.dag_computed` event.  
**Events Emitted:** `task.created` (per task), `task.queued` (per task)  
**AI Involvement:** None. The priority scorer (`src/prioritization/scorer.ts`) is a pure function, not AI.  
**Human Touchpoints:** Users can re-prioritize individual tasks via the dashboard before execution begins.  
**Current Status:** ✅ **Substantially implemented.** Priority scoring, bucket assignment, and ordinal placement all exist. The executor scheduler enforces concurrency limits. **Gap:** no utility that, upon `pipeline.dag_computed`, automatically creates tasks from stories and sets their full dependency graph.

---

### Stage 7: Execution

**Name:** `task.execution`  
**Purpose:** For each queued, unblocked Task, spawn a `claude --print` process in a dedicated git worktree; monitor for completion or stall; capture output; update task status.

**Input Contract:**
```typescript
interface ExecutionInput {
  taskId: string;
  title: string;
  cwd: string;              // project root
  notes: string | null;     // enriched spec as JSON
  declaredFiles: string[];
  domainSlug: string | null;
  rootPromptId: string | null;
  attemptCount: number;
}
```

**Output Contract:**
```typescript
interface ExecutionOutput {
  executorRunId: number;
  sessionId: string | null;  // Claude session ID from JSON output
  resultOk: boolean;
  summary: string;           // "[result] DONE: ..." or "[result] FAILED: ..."
  durationMs: number;
  costUsd: number | null;
  turnCount: number | null;
  filesChanged: string[];
  worktreePath: string;      // for PR creation
}
```

**Trigger:** Task in `queued` state with all `dependsOn` tasks in `completed` state; executor daemon poll tick.  
**Events Emitted:** `worker.spawned`, `executor.task.picked_up`, `task.started`, `task.completed` | `task.failed`  
**AI Involvement:** Claude Haiku / Sonnet / Opus — selected by `selectModel()` based on task complexity signals. The executing agent has full tool access: bash, file read/write, web fetch. The agent operates autonomously within the worktree; the orchestrator middleware enforces banned phrases and autonomy constraints.  
**Human Touchpoints:** Users can pause individual tasks from the dashboard. Blockers generated during execution surface as `blockers` table entries and appear in the `BlockersKanban` UI.  
**Current Status:** ✅ **Fully implemented.** The executor daemon, dispatcher, monitor, circuit breaker, and completion hook all exist and are functional.

---

### Stage 8: PR Creation & Review

**Name:** `task.pr_creation`  
**Purpose:** After a Task (or all Tasks in a Story/Module) completes, create a GitHub pull request from the worktree branch against the project's main branch; run automated checks; post review comments.

**Input Contract:**
```typescript
interface PRCreationInput {
  taskId: string;
  worktreePath: string;
  projectRepoUrl: string;    // e.g. "github.com/prakashgbid/myapp"
  baseBranch: string;        // typically "main"
  storyTitle: string;
  storyAcceptanceCriteria: string[];
  filesChanged: string[];
  resultSummary: string;     // from executor output
  rootPromptId: string;
}
```

**Output Contract:**
```typescript
interface PRCreationOutput {
  prNumber: number;
  prUrl: string;
  headBranch: string;
  reviewChecks: Array<{
    name: string;
    status: 'pass' | 'fail' | 'warning';
    message: string;
  }>;
}
```

**Trigger:** `task.completed` event with `resultOk: true`.  
**Events Emitted:** `pr.created`, `pr.review_started`, `pr.review_completed`  
**AI Involvement:** Claude Sonnet for automated PR review: reads the diff, checks acceptance criteria coverage, flags potential issues, generates the PR description. The review is additive (comments on the PR) and does not block merge automatically.  
**Human Touchpoints:** Human can review the PR diff in the CAIA dashboard (linked to GitHub) or directly on GitHub. The PR is not merged automatically — it waits for the Human Acceptance Gate (Stage 12).  
**Current Status:** ❌ **Missing.** No PR creation utility exists. The GitHub API integration is absent. This is a P0 gap for the full vision.

---

### Stage 9: Testing

**Name:** `task.testing`  
**Purpose:** Run the project's unit test suite and E2E behavioral tests against the changes in the worktree; update the behavior test registry; surface failures as blockers.

**Input Contract:**
```typescript
interface TestingInput {
  taskId: string;
  worktreePath: string;
  projectCwd: string;
  changedFiles: string[];
  testFramework: 'vitest' | 'jest' | 'playwright';
  testScope: 'affected' | 'full';  // 'affected' uses file→test mapping
}
```

**Output Contract:**
```typescript
interface TestingOutput {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{
    testId: string;
    testName: string;
    failureExcerpt: string;
    kind: 'regression' | 'new-bug' | 'flake';
  }>;
  behaviorTestUpdates: Array<{
    testId: string;
    status: 'pass' | 'fail' | 'new';
  }>;
}
```

**Trigger:** `pr.created` event.  
**Events Emitted:** `behavior_test.passed` | `behavior_test.failed` (per test), `pipeline.tests_completed`  
**AI Involvement:** Claude Haiku for flake detection (re-runs failing tests and classifies them). Claude Sonnet is invoked when a test fails due to a code change: it reads the failing test, reads the changed code, and proposes a fix — which is dispatched as a new task.  
**Human Touchpoints:** Test failures surface in the `Tests` dashboard view. Users can mark a test as "known flake" or "expected failure" to unblock the pipeline.  
**Current Status:** ⚠️ **Partial.** The behavior test registry (`behavior_tests`, `behavior_test_runs`, `behavior_test_failures` tables), the `behavior-runner` actor in taxonomy, and the `Tests` dashboard route all exist. No daemon automatically runs the test suite after task completion. The `behavior-runner` is referenced in the taxonomy but not implemented as a runnable service.

---

### Stage 10: Build Verification

**Name:** `build.verification`  
**Purpose:** Run the project's full build pipeline (lint, typecheck, bundle) in the worktree to confirm the changes compile and produce a deployable artifact without errors.

**Input Contract:**
```typescript
interface BuildVerificationInput {
  worktreePath: string;
  projectCwd: string;
  buildCommands: Array<{ name: string; command: string; }>;
  gitSha: string;
  branch: string;
}
```

**Output Contract:**
```typescript
interface BuildVerificationOutput {
  buildRunId: string;
  status: 'pass' | 'fail';
  steps: Array<{
    name: string;
    exitCode: number;
    durationMs: number;
    stdoutTail: string;
    stderrTail: string;
  }>;
  artifactPath?: string;  // path to built output for deployment
  errorSignature?: string;
}
```

**Trigger:** `pipeline.tests_completed` with all tests passing.  
**Events Emitted:** `build.started`, `build.completed` | `build.failed`  
**AI Involvement:** Claude Sonnet is invoked when a build fails: it reads the error output, identifies the root cause, and either (a) spawns a fix task or (b) escalates as a blocker. Build failures due to type errors are auto-fixable; failures due to missing dependencies or configuration issues escalate.  
**Human Touchpoints:** Build failures surface in the `Builds` dashboard view. Users can inspect step-by-step output.  
**Current Status:** ⚠️ **Partial.** The `build_runs`, `build_steps`, `build_retries` tables exist (migration 0009). A `build-runner.sh` script is referenced in `package.json` scripts. The `Builds` dashboard route exists. No daemon automatically triggers builds as part of the pipeline after testing.

---

### Stage 11: Deployment

**Name:** `build.deployment`  
**Purpose:** Deploy the verified build artifact to the staging environment (Cloudflare Pages or GCP Cloud Run); verify the deployment is live and the feature URL returns HTTP 200; capture the staging URL for human review.

**Input Contract:**
```typescript
interface DeploymentInput {
  buildRunId: string;
  artifactPath: string;
  target: 'cloudflare-pages' | 'gcp-cloud-run' | 'custom';
  environment: 'staging' | 'production';
  projectSlug: string;
  gitSha: string;
  branch: string;
}
```

**Output Contract:**
```typescript
interface DeploymentOutput {
  deploymentId: string;
  stagingUrl: string;
  status: 'live' | 'failed' | 'timeout';
  durationMs: number;
  healthCheckResult: {
    url: string;
    statusCode: number;
    responseMs: number;
  };
}
```

**Trigger:** `build.completed` with `status: 'pass'`.  
**Events Emitted:** `deployment.started`, `deployment.completed` | `deployment.failed`  
**AI Involvement:** None for the deployment action itself. Claude Haiku is used for post-deployment health verification: fetch the staging URL, compare the rendered HTML against the story's expected behavior, and flag visual or functional regressions.  
**Human Touchpoints:** Users are notified (via dashboard notification + optional email/Slack) when staging is ready for review.  
**Current Status:** ❌ **Missing.** No deployment utility exists. Cloudflare Pages and GCP integrations are referenced in the vision but absent from the codebase.

---

### Stage 12: Human Acceptance

**Name:** `human.acceptance`  
**Purpose:** Present the deployed staging feature to the human for review; collect explicit approval or rejection with optional feedback; gate the production release.

**Input Contract:**
```typescript
interface HumanAcceptanceInput {
  promptId: string;
  stagingUrl: string;
  prUrl: string;
  changedFiles: string[];
  acceptanceCriteria: string[];
  aiReviewSummary: string;
  testResults: { passed: number; failed: number; };
  buildStatus: 'pass';
}
```

**Output Contract:**
```typescript
interface HumanAcceptanceOutput {
  decision: 'approved' | 'rejected' | 'approved_with_changes';
  feedback?: string;
  changesRequested?: Array<{ criterion: string; note: string }>;
  decidedAt: string;
  decidedBy: string;
}
```

**Trigger:** `deployment.completed` with `status: 'live'`.  
**Events Emitted:** `human.acceptance_requested`, `human.acceptance_granted` | `human.acceptance_rejected`  
**AI Involvement:** None at the decision point. Before surfacing to the human, Claude Sonnet generates an "acceptance report": a structured summary of what changed, which acceptance criteria are provably met (via test results and file evidence), and which require manual verification.  
**Human Touchpoints:** The primary human touchpoint in the pipeline. The `Human Acceptance Review` dashboard view (see Section 5) presents: staging URL, PR diff link, acceptance criteria checklist, AI review summary, approve/reject buttons.  
**Current Status:** ❌ **Missing.** No acceptance gate UI or backend flow exists.

---

### Stage 13: Production Release

**Name:** `release.production`  
**Purpose:** Merge the approved PR to the main branch; trigger the production deployment pipeline; verify production is live; tag the release.

**Input Contract:**
```typescript
interface ReleaseInput {
  prNumber: number;
  prUrl: string;
  projectRepoUrl: string;
  acceptanceDecision: 'approved' | 'approved_with_changes';
  deployTarget: 'cloudflare-pages' | 'gcp-cloud-run';
}
```

**Output Contract:**
```typescript
interface ReleaseOutput {
  mergeCommitSha: string;
  productionUrl: string;
  releaseTag: string;      // e.g. "v1.4.2-prompt-prm_abc123"
  deploymentId: string;
  status: 'live' | 'rollback';
}
```

**Trigger:** `human.acceptance_granted` event.  
**Events Emitted:** `release.started`, `release.completed` | `release.failed`  
**AI Involvement:** None for the merge/deploy action. Claude Haiku for generating the release tag description.  
**Human Touchpoints:** None. This stage is fully automated after human approval.  
**Current Status:** ❌ **Missing.**

---

### Stage 14: Observability Closeout

**Name:** `prompt.closeout`  
**Purpose:** Mark the originating Prompt as completed; compute cost/performance metrics for the full pipeline run; update the prompt_pipeline_stages table to terminal state; emit the final summary event.

**Input Contract:**
```typescript
interface CloseoutInput {
  promptId: string;
  releaseOutput: ReleaseOutput;
  pipelineStartedAt: string;
}
```

**Output Contract:**
```typescript
interface CloseoutOutput {
  promptId: string;
  totalDurationMs: number;
  totalCostUsd: number;
  totalTokens: { input: number; output: number };
  stagesCompleted: string[];
  storiesDelivered: number;
  filesChanged: string[];
  productionUrl: string;
}
```

**Trigger:** `release.completed` event.  
**Events Emitted:** `prompt.completed` (the terminal event for a prompt's lifecycle)  
**AI Involvement:** None.  
**Human Touchpoints:** The Prompt Detail view updates to show the final summary card.  
**Current Status:** ⚠️ **Partial.** The `prompt_pipeline_stages` table and stage-tracking infrastructure exist. No closeout utility computes and persists the final metrics, and the `prompt.completed` event type does not exist in the taxonomy yet.

---

## Section 4: Utility Catalogue

Each utility is the deployable unit of CAIA's plugin architecture. Utilities communicate exclusively via the event bus or the CAIA API — never direct function calls across process boundaries.

---

### `@caia/ingester`
**Responsibility:** Accept prompt submissions from the GUI, CLI, or API; deduplicate; write to `prompts` table; emit `prompt.ingested`.  
**Input:** `PromptIngestionInput`  
**Output:** `PromptIngestionOutput`  
**Exists?** Yes — `src/api/routes/prompts.ts` + `src/prompts/manager.ts`  
**AI Model:** None  
**Open-Source Viability:** High — generic prompt intake with deduplication and correlation ID assignment is universally useful  

---

### `@caia/clarifier`
**Responsibility:** Given a prompt and project context, use AI to generate targeted clarifying questions; present to user; collect answers; emit completion.  
**Input:** `ClarificationInput`  
**Output:** `ClarificationOutput`  
**Exists?** No — the `questions` table and UI exist, but the AI clarification agent does not  
**AI Model:** Claude Haiku (fast question generation); Claude Sonnet for complex ambiguity analysis  
**Open-Source Viability:** High — question generation from ambiguous requirements is universally applicable  

---

### `@caia/decomposer`
**Responsibility:** The most complex utility. Takes a clarified prompt, runs a two-phase AI decomposition (Initiative+Epic+Module in phase 1; Stories in parallel in phase 2); writes the full tree to `stories`; emits `story.created` per node.  
**Input:** `DecompositionInput`  
**Output:** `DecompositionOutput`  
**Exists?** No (the `story-backfiller` is a placeholder, not a real decomposer)  
**AI Model:** Claude Sonnet for phase 1; parallel Claude Sonnet/Haiku for phase 2 stories  
**Open-Source Viability:** Very high — this is the central value-add of any AI engineering platform  
**Implementation Notes:**
- Use Anthropic structured output (JSON schema enforcement) to guarantee parseable responses
- Phase 2 parallelism: spawn one API call per Module concurrently using `Promise.all`
- Include chain-of-thought reasoning step ("first, identify the major capability areas; then, for each area, identify the independent modules...")
- The system prompt must include: project file tree, domain taxonomy, lock contracts, example well-formed stories from the existing `stories` table

---

### `@caia/enricher`
**Responsibility:** For each leaf Story, use AI to expand the description into a detailed implementation brief: exact file paths, function signatures, test cases, dependency requirements, and model recommendation.  
**Input:** `EnrichmentInput`  
**Output:** `EnrichmentOutput`  
**Exists?** No  
**AI Model:** Claude Haiku for `estimatedComplexity: 'trivial' | 'simple'`; Claude Sonnet for `'moderate' | 'complex'`  
**Open-Source Viability:** Medium — useful but tightly coupled to CAIA's story schema  

---

### `@caia/dag-analyzer`
**Responsibility:** Build the DAG from story `dependsOn` fields plus file-overlap detection; validate for cycles; compute parallel batches; estimate wall-clock duration.  
**Input:** `DependencyAnalysisInput`  
**Output:** `DependencyAnalysisOutput`  
**Exists?** No (partial: `dependsOn` fields exist; the `DagView` component exists)  
**AI Model:** None for DAG construction (Kahn's algorithm). Optional: Claude Haiku for semantic dependency inference.  
**Open-Source Viability:** Very high — a standalone TypeScript DAG library for AI task orchestration is broadly useful  

---

### `@caia/scheduler`
**Responsibility:** Given the DAG output, create Tasks in the DB with correct priority scores, bucket assignments, ordinals, and dependency linkage; feed the executor queue.  
**Input:** `SchedulingInput`  
**Output:** `SchedulingOutput`  
**Exists?** Partially — `src/prioritization/` (scorer, bucketer, placer, reprioritizer) all exist; what's missing is the bridge from Stories to Tasks  
**AI Model:** None  
**Open-Source Viability:** Medium — the priority scoring logic is opinionated and domain-specific  

---

### `@caia/worktree-manager`
**Responsibility:** Create and destroy git worktrees for task execution; manage the worktree namespace; handle cleanup after PR creation.  
**Input:** `{ taskId: string; config: DispatchConfig }`  
**Output:** `{ worktreePath: string }`  
**Exists?** Yes — embedded in `apps/executor/dispatcher.ts` (`createWorktree`, `cleanupWorktree`). Should be extracted to a standalone utility.  
**AI Model:** None  
**Open-Source Viability:** High — `@caia/worktree-manager` as a standalone package is useful for any git-based AI agent framework  

---

### `@caia/executor`
**Responsibility:** The execution engine. Manages the full lifecycle of spawning `claude --print` processes: prompt building, model selection, process spawning, output capture, completion detection, retry logic, circuit breaking.  
**Input:** `ExecutionInput`  
**Output:** `ExecutionOutput`  
**Exists?** Yes — `apps/executor/` (daemon, dispatcher, scheduler, monitor, completion-hook, breaker). Production-grade.  
**AI Model:** Claude Haiku / Sonnet / Opus — selected by `selectModel()` based on task signals  
**Open-Source Viability:** Very high — a production-grade Claude Code executor with circuit breaking and worktree management is the most reusable component in the platform  

---

### `@caia/pr-manager`
**Responsibility:** Create GitHub PRs from completed worktrees; run AI-powered code review; post review comments; track PR status; handle merge conflicts.  
**Input:** `PRCreationInput`  
**Output:** `PRCreationOutput`  
**Exists?** No  
**AI Model:** Claude Sonnet for PR review and description generation  
**Open-Source Viability:** High — standalone GitHub PR management for AI agents is broadly needed. Depends on: `@octokit/rest` (or GitHub's native API)  
**Implementation Notes:**
- Use `git push origin HEAD:refs/heads/task-{taskId}` from the worktree
- Create PR via GitHub API with auto-generated description including: story link, acceptance criteria, changed files, AI execution summary
- Run review: fetch diff, construct prompt, get structured review JSON, post as PR comments
- Track status in a `pull_requests` table (new migration needed)

---

### `@caia/test-runner`
**Responsibility:** Run the project's test suite (Vitest unit tests + Playwright E2E) scoped to changed files; update the behavior test registry; surface failures as blockers; optionally spawn fix tasks.  
**Input:** `TestingInput`  
**Output:** `TestingOutput`  
**Exists?** Partial — behavior test registry and tables exist; no runner daemon  
**AI Model:** Claude Haiku for flake detection; Claude Sonnet for test failure root cause analysis and fix generation  
**Open-Source Viability:** Medium — useful but tightly coupled to Vitest/Playwright  

---

### `@caia/build-verifier`
**Responsibility:** Run the project's build pipeline in the worktree; capture step-by-step output; persist to `build_runs`/`build_steps`; trigger AI-powered error diagnosis on failure.  
**Input:** `BuildVerificationInput`  
**Output:** `BuildVerificationOutput`  
**Exists?** Partial — schema exists; `build-runner.sh` referenced; no daemon integration  
**AI Model:** Claude Sonnet for build failure diagnosis  
**Open-Source Viability:** High — a build verification daemon with AI error diagnosis is broadly useful  

---

### `@caia/deployment-manager`
**Responsibility:** Deploy build artifacts to Cloudflare Pages (static sites/Next.js) or GCP Cloud Run (APIs/services); verify deployment health; capture staging URL.  
**Input:** `DeploymentInput`  
**Output:** `DeploymentOutput`  
**Exists?** No  
**AI Model:** None for deployment actions. Claude Haiku for post-deployment health verification.  
**Open-Source Viability:** Medium — too opinionated to Cloudflare/GCP to be universally applicable; best as a plugin  
**Implementation Notes:**
- Cloudflare Pages: use `wrangler pages deploy <artifact-path> --project-name=<name> --branch=staging`
- GCP Cloud Run: use `gcloud run deploy <service> --image=<image> --region=<region>`
- Abstract via a `DeploymentProvider` interface so additional providers (Vercel, Railway, Fly.io) can be added

---

### `@caia/acceptance-gate`
**Responsibility:** When staging is live, notify the human; present the acceptance review view; collect approve/reject decision; persist the outcome; trigger release or re-execution.  
**Input:** `HumanAcceptanceInput`  
**Output:** `HumanAcceptanceOutput`  
**Exists?** No  
**AI Model:** Claude Sonnet for the pre-review acceptance report generation  
**Open-Source Viability:** Medium — the UX pattern is useful but the data model is CAIA-specific  

---

### `@caia/release-manager`
**Responsibility:** Merge approved PRs to main; trigger production deployment; verify production health; tag the release; notify stakeholders.  
**Input:** `ReleaseInput`  
**Output:** `ReleaseOutput`  
**Exists?** No  
**AI Model:** Claude Haiku for release tag description  
**Open-Source Viability:** Medium — useful for any AI-driven CD pipeline  

---

### `@caia/event-bus`
**Responsibility:** Dual-path event delivery: in-process `EventEmitter` with picomatch glob subscriptions + SQLite outbox for persistence and replay. The central nervous system of the platform.  
**Input:** `Omit<ConductorEvent, 'id' | 'occurred_at' | 'severity'>`  
**Output:** `ConductorEvent`  
**Exists?** Yes — `packages/event-bus/index.ts`. Production-ready.  
**AI Model:** None  
**Open-Source Viability:** Very high — a typed, SQLite-backed, glob-subscribed event bus for Node.js is broadly useful. Depends on: `better-sqlite3`, `picomatch`  

---

### `@caia/timeline-recorder`
**Responsibility:** Subscribe to all events; write human-readable timeline entries to `timeline_events`; power the `TimelineFeed` dashboard component.  
**Input:** Any `ConductorEvent`  
**Output:** `TimelineEvent` rows in DB  
**Exists?** Yes — `timeline_events` table and `TimelineFeed` component exist. The recorder logic is distributed across route handlers.  
**AI Model:** None  
**Open-Source Viability:** Medium  

---

### `@caia/completeness-verifier`
**Responsibility:** Periodically verify that completed stories/tasks have actual evidence of completion: file exists, URL returns 200, test passes, commit SHA exists. Surface failures as completeness findings.  
**Input:** Scheduled trigger or `task.completed` event  
**Output:** `CompletenessRun` records with per-check findings  
**Exists?** Yes — implemented as a plugin in `~/Documents/projects/plugins/completeness-sentinel/`  
**AI Model:** None  
**Open-Source Viability:** High — completeness verification for AI-generated work is a universally needed quality gate  

---

### `@caia/observability-monitor`
**Responsibility:** Three-layer health check (synthetic canary + state invariants + micro-probes); auto-heal on known failure signatures; persist results to `pulse_runs`.  
**Input:** Scheduled trigger (configurable cron) or on-demand CLI  
**Output:** `PulseResult` with `PASSING | DEGRADED | CRITICAL | AUTO-HEALED` outcome  
**Exists?** Yes — `apps/pipeline-pulse/`. Production-ready.  
**AI Model:** None (uses real task execution as canary)  
**Open-Source Viability:** Very high — a multi-layer pipeline health monitor with auto-healing is independently useful  

---

### `@caia/local-llm-router`
**Responsibility:** Intercept model selection decisions; route tasks to local LLMs (via Ollama) when task complexity, cost budget, or user preference indicates this is appropriate; fall back to Claude when local quality is insufficient.  
**Input:** `DispatchTask` + routing policy config  
**Output:** `{ endpoint: string; model: string; apiKey?: string }`  
**Exists?** Partial — `selectModel()` in `dispatcher.ts` already routes between Claude model tiers. No Ollama integration.  
**AI Model:** N/A — this utility is the router, not the model  
**Open-Source Viability:** High — a Claude-compatible local LLM router with policy-based routing is broadly useful  

---

## Section 5: Dashboard Specification

The dashboard is the primary human interface. All human interaction with the platform happens here — zero terminal required.

### 5.1 Prompt Submission View

**Route:** `/prompts/new`  
**Purpose:** Accept new requirements and initiate the pipeline.  

**Key Data Shown:**
- Large rich text area (supports markdown) for the requirement body
- Project selector dropdown (from `projects` table)
- Priority hint (P0–P3) with tooltip explaining each level
- Labels multi-select (from existing label set)
- "Advanced" collapse: `receivedVia` mode, metadata JSON override
- Character count and estimated cost indicator (tokens × rate)
- Recent prompts list (last 5) for reference

**Interactions:**
- Submit button → POST `/prompts` → redirect to Prompt Detail view
- "Save as Draft" → persists without submitting
- Keyboard shortcut: `Cmd+Enter` to submit

**Real-time vs Static:** Static form; real-time updates to cost estimate as user types (token estimation in client).

---

### 5.2 Prompt List View

**Route:** `/prompts`  
**Purpose:** Overview of all submitted prompts with their current pipeline status.

**Key Data Shown:**
- Table/card list: prompt excerpt (first 100 chars), status badge, project, submitted timestamp, elapsed time, story count, task count, cost (USD)
- Status filter tabs: All | Received | Analyzing | Executing | Staging | Completed | Failed
- Search bar (full-text on prompt body)
- Pagination with cursor

**Interactions:**
- Click row → Prompt Detail view
- Quick actions: Cancel, Re-run (from failed state)

**Real-time:** Status badges update via WebSocket `conductor:event` stream. Elapsed time ticks in real-time.

---

### 5.3 Prompt Detail / Pipeline Waterfall View

**Route:** `/prompts/[id]`  
**Purpose:** The core visualization — drill-down from prompt to every sub-entity in the hierarchy.

**Key Data Shown:**
- Header card: prompt body, status, project, timestamps, cost, token usage
- Pipeline stage progress bar (horizontal waterfall): `ingested → clarifying → decomposing → scheduling → executing → staging → review → released`
- Each stage shows: elapsed time, current status, events count
- **Accordion hierarchy tree:** Initiative → Epic → Module → Story → Task → Subtask
  - Each level is collapsible/expandable
  - Each node shows: title, status badge, duration, assigned domain, model used
  - Color coding: grey (pending) → blue (executing) → green (completed) → red (failed)
- Events timeline (collapsible panel at bottom): all events with `correlationId = promptId`
- Summary statistics: total cost, total tokens, wall-clock time, files changed, tests run

**Interactions:**
- Click any node → open Task Detail (side panel or route)
- Approve/Reject button (visible only when `status = staging_deployed`)
- "Force re-run story" button on failed Stories
- Expand All / Collapse All controls

**Real-time:** Entire tree updates via WebSocket. Active executing nodes show a pulsing indicator and live subtask list.

---

### 5.4 Task Detail View

**Route:** `/tasks/[id]`  
**Purpose:** Full detail for a single task including spec, execution timeline, tool calls, file changes.

**Key Data Shown:**
- Title, description, notes (enriched spec)
- Status, priority bucket, attempt count, model used
- Acceptance criteria checklist (checked off as evidence is found)
- Verification plan steps
- Declared files → Actual files changed (diff)
- Execution history: list of `executor_runs` for this task, each with duration, cost, exit code
- Status transition history (from `task_status_transitions`)
- Events list (filtered by `entity_id = taskId`)
- Raw Claude output (collapsible, syntax highlighted)

**Interactions:**
- "Re-run" button → dispatches a new executor run
- "Pause / Resume" toggle
- "Edit notes" inline editor for enriched spec
- View worktree diff button → opens PR diff or local git diff

**Real-time:** Live output stream during execution (line-by-line from executor's `outputLines`).

---

### 5.5 Execution Live View

**Route:** `/tasks/[id]/live`  
**Purpose:** Real-time view of a running task — tool calls, file changes, subtask progress.

**Key Data Shown:**
- Live terminal-style output stream (monospace, auto-scroll)
- Subtask checklist (updating in real-time from `task_subtasks`)
- Current tool call (e.g. "bash: running `vitest run`")
- Files touched so far
- Turn counter, token counter, elapsed timer

**Interactions:**
- "Kill Task" button (immediate SIGTERM to the process)
- Pause (sends SIGSTOP — for debugging only)
- Copy full output to clipboard

**Real-time:** SSE or WebSocket stream from the executor's stdout capture. This requires the executor to forward `outputLines` to a streaming endpoint as they arrive, not just at completion.

---

### 5.6 Test Results View

**Route:** `/tests`  
**Purpose:** Registry of all behavior tests with pass/fail history.

**Key Data Shown:**
- Table: test name, feature, scope, project, last run status, pass rate (last 30 runs), first seen, last seen
- Filter by: project, feature, scope, status
- Failure heat map: which tests fail most often, correlated with which domains

**Interactions:**
- Click test → test detail (all runs, failure excerpts, linked blockers)
- "Run all" button → triggers test runner for selected project
- Mark as flake / mark as expected failure

**Real-time:** Static with manual refresh; test run status updates via WebSocket when a run is in progress.

---

### 5.7 Deployment Status View

**Route:** `/deployments`  
**Purpose:** Overview of all staging and production deployments.

**Key Data Shown:**
- Table: prompt ID, project, environment, URL, status (live/failed/timeout), deployed at, by (PR #)
- Latest staging URL per project (quick "preview" link)
- Deployment duration trend chart

**Interactions:**
- Click "Open staging URL" → opens in new tab
- "Rollback" button on production deployments (triggers revert + re-deploy)
- "Promote to production" shortcut (for cases where human acceptance was done externally)

**Real-time:** Status updates via WebSocket. Active deployments show a progress indicator.

---

### 5.8 Human Acceptance Review View

**Route:** `/prompts/[id]/review`  
**Purpose:** The human gate. Everything a reviewer needs to approve or reject a staged feature.

**Key Data Shown:**
- Staging URL with embedded preview frame (optional, configurable)
- "Open in new tab" link
- PR diff summary: files changed, additions, deletions, link to GitHub PR
- Acceptance criteria checklist: each criterion with status (provably met by test evidence / requires manual check / failed)
- AI acceptance report: Sonnet's structured analysis of what was built vs what was requested
- Test results summary: N passed, N failed
- Build status badge
- Cost incurred for this prompt

**Interactions:**
- **Approve** button → `human.acceptance_granted` event → triggers Stage 13
- **Reject with feedback** → text area for feedback → `human.acceptance_rejected` → re-queue affected stories
- **Approve with changes** → approve but create follow-up stories for outstanding items
- Individual criterion override: "Mark as met" / "Mark as failed"

**Real-time:** Static once opened (snapshot of the staged build). Notifies user if the staging environment goes down while reviewing.

---

### 5.9 System Health / Observability Dashboard

**Route:** `/observability`  
**Purpose:** Real-time system health monitoring for CAIA platform operators.

**Key Data Shown:**
- Pulse run history: last 20 runs, outcome (PASSING/DEGRADED/CRITICAL/AUTO-HEALED), duration
- Check results grid: 15 named checks × last N runs, color-coded
- Executor status: active workers, queued tasks, circuit breaker states per domain
- Event stream: last 50 events with type, actor, severity
- Metrics: API response times (p50/p95/p99), task throughput (tasks/hour), cost/hour
- Completeness sentinel: last run, score distribution across entities
- DB size and backup status

**Interactions:**
- "Run pulse now" button → on-demand health check
- "Reset circuit breaker" button per domain
- "Enable/disable executor" toggle
- Alert configuration: threshold settings for DEGRADED → notification

**Real-time:** All panels update via WebSocket. Pulse outcomes update immediately. Executor worker count ticks every 10s.

---

## Section 6: Technology Stack Decisions

### 6.1 Frontend Framework: Next.js 14 — Keep

**Decision:** Retain Next.js 14 (App Router).  
**Rationale:** The dashboard already has 20+ route directories with significant component work. Next.js App Router's server components enable efficient data fetching without client-side boilerplate. The framework is mature, well-supported, and aligned with Cloudflare Pages deployment (via `@cloudflare/next-on-pages`). A migration to another framework (Remix, SvelteKit) would cost 4–6 weeks with no user-facing benefit.  
**Action needed:** Ensure the dashboard is deployed via `@cloudflare/next-on-pages` worker rather than Node.js server for production.

---

### 6.2 Realtime: Upgrade from WebSocket to Hybrid SSE + WebSocket

**Decision:** Retain WebSocket for bidirectional communication (executor live output, user actions). Add Server-Sent Events (SSE) for unidirectional broadcast (event feeds, status updates).  
**Rationale:** The current `src/ws/` WebSocket bus works for in-process event forwarding. However, SSE is simpler to implement for read-only streams, has better proxy/CDN support, and automatically reconnects. The split:
- **WebSocket:** Execution live view (high-frequency, bidirectional)
- **SSE:** Event feed, pipeline status updates, notification panel (lower frequency, read-only)

**Implementation:** Add `GET /events/stream` SSE endpoint in Hono. Subscribe to the event bus in-process and forward events as `data:` lines. The Next.js dashboard uses `EventSource` for SSE and existing WebSocket client for execution.

---

### 6.3 Database: SQLite for Single-User; Migrate to Turso for Multi-User

**Decision:** Retain SQLite/Drizzle for single-user/local deployments. Add [Turso](https://turso.tech) (libSQL) as the multi-user/cloud tier.  
**Rationale:** SQLite is excellent for local development and single-user operation — zero-latency, zero-ops, no connection pool. At multi-user or cloud-hosted scale, SQLite's write serialization becomes a bottleneck. Turso provides libSQL-compatible SQLite with distributed reads and is a drop-in swap for `better-sqlite3` via `@libsql/client`. Drizzle ORM already supports libSQL.  
**Migration path:** Add `DATABASE_URL` env var. If `DATABASE_URL` starts with `libsql://`, use `@libsql/client`; otherwise use `better-sqlite3`. The Drizzle schema requires zero changes.  
**Action:** No migration needed now. Add Turso support in Phase 4 when multi-user is required.

---

### 6.4 Task Queue: Upgrade from Polling to BullMQ

**Decision:** Migrate from polling to [BullMQ](https://docs.bullmq.io/) (Redis-backed) for the execution queue in production deployments.  
**Rationale:** The current executor daemon polls `GET /tasks?status=queued` every 10 seconds. This is fine for single-machine, low-throughput use. It breaks for: multiple executor instances, task retries with backoff, rate limiting, job prioritization with Redis sorted sets, and delayed/scheduled execution. BullMQ is the Node.js standard for these requirements.  
**Migration plan:**
1. Retain the polling executor as the "lite" mode (default for local/single-user)
2. Add BullMQ mode behind a feature flag (`EXECUTOR_QUEUE=bullmq`)
3. The `@caia/scheduler` utility publishes to a BullMQ queue instead of updating task status directly
4. The executor daemon becomes a BullMQ worker
5. Redis is required in BullMQ mode — recommend [Upstash Redis](https://upstash.com/) for serverless deployments

**Action:** Plan for Phase 3 (after core pipeline works end-to-end).

---

### 6.5 Local LLM Stack: Ollama with Qwen2.5-Coder

**Decision:** Use [Ollama](https://ollama.ai/) as the local LLM runtime. Primary model: `qwen2.5-coder:7b` for code tasks; `phi4:14b` for reasoning tasks.  
**Rationale:** Ollama is the de-facto standard for local model serving on macOS (the user's platform). It supports Apple Silicon Metal acceleration, has a well-maintained API compatible with the OpenAI spec, and supports all leading open models. The `qwen2.5-coder` series is the strongest open model for code generation tasks as of 2026, outperforming older CodeLlama variants on most benchmarks. `phi4:14b` (Microsoft, 14B parameters) is excellent for analytical tasks like dependency analysis and requirement clarification.  
**Hardware:** Qwen2.5-Coder:7B requires ~8GB VRAM (runs well on M2 Pro and above). The 14B variant needs ~16GB unified memory (M2 Max / M3 Pro minimum).

---

### 6.6 Testing Framework: Vitest + Playwright — Keep

**Decision:** Retain Vitest for unit/integration tests and Playwright for E2E.  
**Rationale:** Both are already configured. Vitest is the modern Jest replacement with native TypeScript support and significantly faster hot-reload. Playwright is the standard for E2E testing with excellent component testing support. No migration value.  
**Action:** Ensure the test runner utility (`@caia/test-runner`) invokes `vitest run --reporter=json` for machine-readable output and `playwright test --reporter=json` for E2E results.

---

### 6.7 Deployment Targets: Cloudflare Pages + GCP Cloud Run — Confirm with additions

**Decision:** Cloudflare Pages for frontend (Next.js dashboard + static sites); GCP Cloud Run for backend services (CAIA API, executor daemon, auxiliary daemons).  
**Rationale:** Cloudflare Pages has first-class Next.js support via `@cloudflare/next-on-pages`. It provides a CDN-backed deployment with zero cold starts for the dashboard. GCP Cloud Run provides serverless container execution with automatic scaling to zero — ideal for the CAIA API server which needs persistent WebSocket connections (use Cloud Run's minimum instance = 1 setting).  
**Additional target:** Add Railway.app as an alternative to GCP for teams that want simpler ops. The `DeploymentProvider` interface in `@caia/deployment-manager` should abstract over both.

---

### 6.8 Monorepo Tooling: pnpm + Turborepo — Keep and Formalise

**Decision:** Retain pnpm workspaces + Turborepo.  
**Rationale:** The conductor repo uses npm (single package). As CAIA consolidates into a monorepo (`github.com/prakashgbid/caia`), pnpm workspaces + Turborepo are the correct choice for managing the multi-package structure with build caching. Turborepo's remote cache (Vercel or self-hosted) will dramatically speed up CI builds.  
**Workspace structure recommendation:**
```
caia/
  apps/
    dashboard/          # Next.js dashboard
    api-server/         # Hono API + event bus
    executor/           # Executor daemon
    pipeline-pulse/     # Health monitor
    story-backfiller/   # (replace with @caia/decomposer)
    orchestrator-middleware/
    completeness-sentinel/
    db-backup/
    task-run-poller/
  packages/
    event-bus/          # @caia/event-bus
    events-taxonomy/    # @caia/events-taxonomy
    logger/             # @caia/logger
    test-kit/           # @caia/test-kit
    decomposer/         # @caia/decomposer (new)
    dag-analyzer/       # @caia/dag-analyzer (new)
    pr-manager/         # @caia/pr-manager (new)
    deployment-manager/ # @caia/deployment-manager (new)
    local-llm-router/   # @caia/local-llm-router (new)
```

---

### 6.9 Event Bus: Upgrade Path for Multi-Process

**Decision:** Retain in-process EventEmitter for single-process deployments; upgrade to NATS (or Redis Pub/Sub) for multi-process.  
**Rationale:** The current bus is excellent but single-process. When the executor, API server, and auxiliary daemons are separate processes (the target architecture), events emitted in the executor don't reach WebSocket subscribers in the API server process without an inter-process transport. NATS is the right upgrade:
- Lightweight (single ~25MB binary)
- JetStream for at-least-once delivery and event replay (replacing the SQLite outbox for inter-process delivery)
- Native fan-out matching the picomatch glob pattern
- The `EventDb` interface in `@caia/event-bus` can be swapped for a NATS JetStream adapter

**Migration path:** The `EventBus` already has an injectable `EventDb` interface. Adding an `EventTransport` abstraction alongside it allows swapping the in-process emit for NATS publish without changing subscriber code.

---

## Section 7: Local LLM Strategy

### 7.1 Task Classification for Local vs Claude

The routing decision between local LLM and Claude is primarily a function of task complexity and required output quality. The following framework governs routing:

#### Must Use Claude

These task types require the full capability of Claude Sonnet or Opus. Using a local model here produces unacceptably degraded output:

- **AI Hierarchy Decomposition** (`@caia/decomposer`): Complex multi-level reasoning, understanding implicit dependencies, respecting project conventions. Requires Claude Sonnet.
- **Novel multi-file code generation**: Writing code that spans multiple files with coherent shared state, non-trivial business logic, or complex async patterns. Requires Claude Sonnet.
- **Architecture decisions and ADRs**: Strategic technical decisions require deep reasoning and broad knowledge. Requires Claude Sonnet or Opus.
- **Complex refactors**: Any task touching more than 5 files with inter-dependent changes. Requires Claude Sonnet.
- **Security-sensitive code**: Authentication, authorization, cryptography, data sanitization. Requires Claude Sonnet.
- **Test failure root cause analysis**: Debugging complex multi-layered failures. Requires Claude Sonnet.

#### Good Candidates for Local LLM

These task types produce acceptable quality from local models and run at significantly lower cost and latency:

- **Requirement clarification question generation** (`@caia/clarifier`): Generating 3–5 structured questions from a prompt. Phi4:14b handles this well.
- **Task enrichment for trivial/simple stories**: Expanding a story title into file paths and function stubs for well-understood patterns. Qwen2.5-Coder:7b.
- **Boilerplate code generation**: CRUD routes, migration files, interface definitions, barrel exports. Qwen2.5-Coder:7b.
- **Rename-only tasks**: File renames, variable renames, string find-and-replace. Qwen2.5-Coder:7b (or Haiku).
- **Test generation for simple functions**: Writing unit tests for pure functions with known inputs/outputs. Qwen2.5-Coder:7b.
- **Simple summarization**: Generating PR descriptions, commit messages, timeline summaries. Phi4:14b.
- **Dependency analysis semantic inference**: Detecting file-overlap dependencies (not requiring deep code understanding). Qwen2.5-Coder:7b.
- **Build error classification**: Classifying a build error as "type error", "missing import", "configuration error". Phi4:14b.

### 7.2 Recommended Local Models (2026)

| Model | Size | Hardware Required | Best For | Quality vs Sonnet |
|-------|------|------------------|----------|------------------|
| `qwen2.5-coder:7b` | 7B, ~5GB | M2 Pro (8GB+) | Code generation, boilerplate | 70-75% |
| `qwen2.5-coder:14b` | 14B, ~10GB | M2 Max (16GB+) | Complex code, moderate refactors | 80-85% |
| `phi4:14b` | 14B, ~10GB | M2 Max (16GB+) | Reasoning, analysis, summaries | 80% for reasoning |
| `deepseek-coder-v2:16b` | 16B, ~12GB | M2 Max (16GB+) | Code analysis, review | 82% |
| `codestral:22b` | 22B, ~16GB | M3 Max (24GB+) | Production-quality code gen | 88% |

**Recommendation for the target hardware (Mac with M-series):**
- Default config: `qwen2.5-coder:7b` (fast, fits M2 Pro)
- High-quality config: `qwen2.5-coder:14b` + `phi4:14b` (M2 Max or better)

### 7.3 Routing Logic

The `@caia/local-llm-router` utility implements a policy-based routing decision:

```typescript
interface RoutingPolicy {
  // Budget controls
  monthlyCostLimitUsd: number;
  currentMonthCostUsd: number;
  
  // Quality thresholds
  minQualityForLocalLLM: 0.7;  // tasks below this complexity threshold go local
  
  // User preferences
  preferLocalWhenAvailable: boolean;
  alwaysUseClaudeForDomains: string[];  // e.g. ['security', 'data-backend']
}

function routeTask(task: DispatchTask, policy: RoutingPolicy): RoutingDecision {
  // Explicit override wins
  if (task.notes?.model === 'claude') return { type: 'claude', model: selectClaudeModel(task) };
  if (task.notes?.model === 'local') return { type: 'local', model: 'qwen2.5-coder:7b' };
  
  // Security-sensitive domains always use Claude
  if (policy.alwaysUseClaudeForDomains.includes(task.domainSlug)) 
    return { type: 'claude', model: 'claude-sonnet-4-6' };
  
  // Budget exceeded → route everything possible to local
  if (policy.currentMonthCostUsd >= policy.monthlyCostLimitUsd)
    return localIfCapable(task) ?? { type: 'claude', model: 'claude-haiku-4-5-20251001' };
  
  // Complexity-based routing
  const complexity = estimateComplexity(task);
  if (complexity < 0.4 && policy.preferLocalWhenAvailable)
    return { type: 'local', model: complexity < 0.2 ? 'qwen2.5-coder:7b' : 'qwen2.5-coder:14b' };
  
  return { type: 'claude', model: selectClaudeModel(task) };
}
```

### 7.4 Integration Pattern

The local LLM integrates as a drop-in replacement via the Ollama API's OpenAI-compatible endpoint:

- Ollama exposes `http://localhost:11434/v1` (OpenAI-compatible)
- The `@caia/executor` replaces `claude --print` with a direct API call when routing to local
- Response is normalized to the same `ExecutionOutput` interface
- The `[result] DONE/FAILED` protocol is identical — the prompt template is unchanged
- Cost tracking: local model runs have `costUsd = 0` in `executor_runs`

**Constraint:** Local LLMs cannot use the Claude Code tool (`claude --print`) and cannot access `claude`'s built-in tools (bash, file I/O). Local model execution must use the Anthropic-compatible tool-use API via the SDK, with CAIA-provided tool implementations. This is a significant integration lift — recommend implementing local LLM support after the core pipeline is working end-to-end (Phase 6).

---

## Section 8: Gap Analysis — Vision vs Current State

| Component | Vision | Current State | Gap Size | Priority |
|-----------|--------|---------------|----------|----------|
| Prompt intake GUI | Rich text area with options, project selector, priority hint | Route `/prompts/new` may exist as skeleton | Medium | P0 |
| AI Hierarchy Decomposer | Full Initiative→Epic→Module→Story tree from single prompt | `story-backfiller`: creates 1 flat Epic per requirement, no AI | **Large** | **P0** |
| Requirement Clarifier | AI proactively asks clarifying questions before decomposition | Questions table + kanban exist; no AI clarifier agent | Medium | P1 |
| Task Enrichment | Detailed specs with file paths, function signatures, test cases | No enricher; stories created with minimal metadata | Large | P1 |
| Dependency Analysis (DAG) | Full DAG with cycle detection, parallel batches, critical path | `dependsOn` fields exist; no DAG utility | Medium | P1 |
| Story→Task Bridge | Scheduler creates Tasks from Stories after decomposition | Manual task creation only; no automatic Story→Task bridge | Large | P0 |
| Executor | Spawns Claude Code workers with worktrees, circuit breaking | Fully implemented and production-grade | None | — |
| Priority Scoring | Multi-dimensional composite scorer (0-100) | Fully implemented (7 dimensions, P0-P3 buckets) | None | — |
| PR Creation | GitHub PR from worktree, AI review, status tracking | **Missing** | **Large** | **P1** |
| Test Runner | Auto-run Vitest + Playwright after task completion | Tables exist; no runner daemon | Medium | P1 |
| Build Verification | Auto-run build pipeline, AI error diagnosis | Schema + script exist; not integrated into pipeline | Medium | P1 |
| Deployment (Staging) | Cloudflare Pages / GCP deploy, health verify | **Missing** | **Large** | **P2** |
| Human Acceptance Gate | Structured review UI, approve/reject, re-queue on reject | **Missing** | **Large** | **P2** |
| Production Release | Merge PR, production deploy, tag release | **Missing** | **Large** | **P2** |
| Observability Closeout | Final metrics, cost summary, prompt marked completed | Partial: stage tracking exists; no closeout utility | Small | P3 |
| Event Bus | Typed, persisted, glob-subscribed, replay-capable | Fully implemented | None | — |
| Timeline Recorder | Human-readable activity feed | Tables + component exist | None | — |
| Completeness Verifier | File/URL/test evidence checks on completed work | Implemented as external plugin | None | — |
| Pipeline Pulse | 3-layer health check with auto-heal | Fully implemented | None | — |
| Orchestrator Middleware | Banned phrases, prompt tracing, task-run acknowledgement | Fully implemented | None | — |
| Local LLM Router | Policy-based Claude vs local routing, Ollama integration | Partial: Claude model routing exists; no Ollama | Large | P3 |
| Streaming Execution Output | Live tool calls + output in dashboard | Output captured at end only; no real-time streaming | Medium | P2 |
| Dashboard: Prompt Waterfall | Full accordion drill-down from prompt to subtask | Route + API (`/prompts/[id]/pipeline`) exist; UI incomplete | Medium | P1 |
| Dashboard: Acceptance Review | Staging preview, criteria checklist, approve/reject | Missing | Large | P2 |
| Dashboard: Live Execution | Real-time output stream, subtask list, tool calls | Skeleton exists; no live data | Medium | P2 |
| GitHub Integration | PR creation, status tracking, merge | **Missing** | **Large** | **P1** |
| Cloudflare/GCP Deploy | Automated deployment to staging + production | **Missing** | **Large** | **P2** |
| Multi-user Support | Multiple users, per-user cost tracking, access control | Single-user SQLite; no auth | Large | P4 |
| Local LLM (Ollama) | Route tasks to local models; cost reduction | No Ollama integration | Large | P3 |

---

## Section 9: Implementation Phases

### Phase 1: Foundation Hardening (Weeks 1–3)

**Goal:** Everything that exists must be solid, tested, and documented before building on top. Close technical debt before adding features.

**Deliverables:**
1. **Monorepo migration:** Confirm all `conductor` code is correctly placed in the CAIA monorepo at `apps/orchestrator/` and `packages/`. Verify all imports and builds pass.
2. **`stories` table: add `initiative` kind:** Migrate the `kind` enum to include `initiative`. Add the `prompt_pipeline_stages` tracking for all 14 pipeline stages defined in Section 3.
3. **Event taxonomy extension:** Add missing event types: `prompt.clarification_started/completed`, `pipeline.dag_computed`, `pr.created/merged`, `deployment.started/completed`, `human.acceptance_requested/granted/rejected`, `release.completed`, `prompt.completed`.
4. **Test coverage gate:** Ensure unit test coverage ≥ 80% on `packages/event-bus`, `packages/events-taxonomy`, `src/prioritization/`, `apps/orchestrator-middleware/`. Enforce via the existing `gate:coverage` script.
5. **API contract documentation:** Document all existing `/prompts`, `/stories`, `/tasks`, `/executor` routes with TypeScript request/response types. This becomes the contract for the new utilities.
6. **Executor streaming:** Modify `apps/executor/dispatcher.ts` to POST `outputLines` to `POST /task-runs/{id}/output` as they arrive. Add SSE endpoint `GET /task-runs/{id}/stream` in the API server. This unblocks the Live Execution dashboard view.

**Dependencies:** None.  
**Risk:** Monorepo migration may surface hidden import issues. Run full build + test suite before marking complete.

---

### Phase 2: Core Pipeline — Ingestion Through Scheduling (Weeks 4–7)

**Goal:** A user can submit a prompt and get a fully decomposed, enriched, scheduled task queue without any manual intervention.

**Deliverables:**
1. **`@caia/clarifier` utility:** AI-powered question generation. Subscribe to `prompt.ingested`, classify clarity score, generate questions if `score < 0.85`. Surface questions in the `QuestionsKanban` dashboard. Emit `prompt.clarification_completed` when all critical questions are answered (or immediately if `canSkip: true`).
2. **`@caia/decomposer` utility:** The flagship new component. Two-phase decomposition: Initiative+Epic+Module (phase 1, single Sonnet call) followed by Stories per Module (phase 2, parallel Haiku/Sonnet calls). Use Anthropic's structured output API. Write all nodes to `stories` table with `rootPromptId` linkage. Emit `pipeline.decompose_completed`.
3. **`@caia/enricher` utility:** Subscribe to `pipeline.decompose_completed`. For each leaf Story, call Claude (Haiku/Sonnet by complexity) to produce the detailed implementation spec. Store enriched spec in `stories.description` + a new `enriched_spec_json` column.
4. **`@caia/dag-analyzer` utility:** Implement Kahn's algorithm for topological sort of the story DAG. Detect file-overlap implicit dependencies. Validate no cycles. Write `parallel_batch` assignments to a new `stories.parallel_batch` column. Emit `pipeline.dag_computed`.
5. **Story→Task Bridge:** After `pipeline.dag_computed`, automatically create `tasks` rows from `stories` leaf nodes with correct `dependsOn`, `priorityBucket`, `positionOrdinal`, `rootPromptId` linkage. This is the connection between the decomposition world (stories) and the execution world (tasks).
6. **Dashboard: Prompt Waterfall:** Complete the `/prompts/[id]` accordion drill-down view. Wire it to the existing `/prompts/:id/pipeline` API endpoint. Add real-time WebSocket updates.

**Dependencies:** Phase 1 complete.  
**Risk:** Decomposer output quality is the highest risk. Mitigate with extensive prompt engineering and structured output schema validation. Build an evaluation suite of 10 representative prompts and score decomposition quality before shipping.

---

### Phase 3: Execution Hardening & Testing Automation (Weeks 8–11)

**Goal:** Close the execution loop: tasks run, tests run automatically after completion, build is verified, results are surfaced clearly.

**Deliverables:**
1. **BullMQ task queue (optional):** Add BullMQ mode behind `EXECUTOR_QUEUE=bullmq` flag. Retain polling as default. This enables multiple executor instances and proper retry backoff.
2. **`@caia/test-runner` daemon:** Subscribe to `task.completed`. Identify affected test files using vitest's `--related` flag scoped to `filesChanged`. Run tests. Parse JSON results. Update `behavior_test_runs`. Create blockers for failures. Emit `pipeline.tests_completed`.
3. **`@caia/build-verifier` daemon:** Subscribe to `pipeline.tests_completed` (if tests pass). Run the configured build command sequence. Capture step output. Persist to `build_runs`/`build_steps`. On failure: invoke Claude Sonnet for diagnosis, create a fix task. Emit `build.completed`.
4. **Streaming execution output (Phase 2 follow-through):** Complete the Live Execution dashboard view with real-time output and subtask list.
5. **Dashboard: Test Results view:** Complete the `/tests` route with pass/fail history, flake detection, and the run trigger button.
6. **Dashboard: Builds view:** Complete the `/builds` route with step-by-step output, retry controls, and AI error diagnosis display.
7. **Pulse improvements:** Add new pulse checks for: decomposer health (can it decompose a sample prompt?), test runner health (can it run a canary test?), build verifier health.

**Dependencies:** Phase 2 complete.  
**Risk:** Test runner false failures (flaky tests blocking pipeline). Implement the flake classifier early. Also: build commands vary per project — make the build step config driven (stored in `projects` table).

---

### Phase 4: Deployment & Human Acceptance (Weeks 12–15)

**Goal:** A fully automated path from passing tests to a live staging URL ready for human review.

**Deliverables:**
1. **`@caia/pr-manager` utility:** Subscribe to `build.completed`. Push the worktree branch to GitHub. Create a PR with AI-generated description. Run AI code review (Claude Sonnet). Post review comments. Track PR status in a new `pull_requests` table. Emit `pr.created`.
2. **GitHub integration:** Configure `@octokit/rest`. Add `github_token` to the project settings (stored encrypted). Add the repository URL to the `projects` table.
3. **`@caia/deployment-manager` utility:** Subscribe to `pr.created`. Deploy the worktree build to Cloudflare Pages (staging environment). Verify deployment health. Emit `deployment.completed`.
4. **`@caia/acceptance-gate` utility:** Subscribe to `deployment.completed`. Trigger Claude Sonnet to generate the acceptance report. Create a notification. Wait for human decision via `POST /prompts/:id/accept` or `/reject`. Emit `human.acceptance_granted` or `human.acceptance_rejected`.
5. **`@caia/release-manager` utility:** Subscribe to `human.acceptance_granted`. Merge the PR via GitHub API. Trigger production deployment via Cloudflare Pages. Verify production health. Emit `release.completed`.
6. **Dashboard: Human Acceptance view:** Complete the `/prompts/[id]/review` route with staging preview, acceptance criteria checklist, approve/reject buttons.
7. **Dashboard: Deployment Status view:** Complete the `/deployments` route.
8. **Observability Closeout:** On `release.completed`, compute final metrics and mark the prompt as `completed`. Emit `prompt.completed`.
9. **Database: Turso libSQL support:** Add `DATABASE_URL` env var support with `@libsql/client`. Enables cloud-hosted CAIA instances.

**Dependencies:** Phase 3 complete.  
**Risk:** GitHub API rate limits for prolific prompt runs. Implement exponential backoff in `@caia/pr-manager`. Also: Cloudflare Pages project setup must be done once per target project — add to the project onboarding flow.

---

### Phase 5: Dashboard Completion (Weeks 16–18)

**Goal:** The dashboard is fully functional for all pipeline stages. A non-technical user can track, review, and control the full pipeline without touching a terminal.

**Deliverables:**
1. Complete all incomplete dashboard views from Section 5.
2. **Notification system:** Add a notification panel (bell icon, top-right). When staging is ready, send an in-app notification and optional email/Slack webhook. Uses the `notifications/index.ts` system that already exists.
3. **Settings page completion:** Project configuration (GitHub token, Cloudflare token, GCP credentials, executor settings, build commands).
4. **Mobile-responsive layout:** Ensure the prompt waterfall and observability views work on tablet/mobile for reviewing from staging.
5. **Keyboard shortcuts:** Power-user shortcuts for common actions (submit prompt, navigate between stages, approve/reject).
6. **Prompt history:** Full-text search across all prompts and their descendants.

**Dependencies:** Phases 1–4 complete (all data sources must exist for the views to render).  
**Risk:** Low. This is UI polish work with known data shapes. Primary risk is design inconsistency — recommend using a design system (shadcn/ui, already referenced in the artifact system) consistently.

---

### Phase 6: Local LLM Integration (Weeks 19–21)

**Goal:** Reduce Claude API costs by 40–60% by routing appropriate tasks to local Ollama models.

**Deliverables:**
1. **`@caia/local-llm-router` utility:** Implement the routing policy from Section 7. Configuration via the Settings page (monthly budget, prefer-local toggle, domain exclusions).
2. **Ollama integration in executor:** When the router returns `{ type: 'local' }`, invoke the Ollama OpenAI-compatible API with CAIA's tool implementations (bash, file read/write) instead of `claude --print`.
3. **Tool implementation for local LLMs:** Implement a lightweight tool execution loop: send prompt to Ollama API, parse tool calls, execute tools, send results back, loop until `[result]` marker. This is the non-trivial part — it's reimplementing what `claude --print` does internally.
4. **Cost dashboard:** Add cost breakdown by model (Claude Haiku/Sonnet/Opus vs local) to the Observability dashboard. Show 30-day cost trend and monthly projection.
5. **Quality feedback loop:** After each local LLM task, record `resultOk` and `completenessScore`. If local model success rate on a task type drops below 70%, automatically escalate to Claude next time.

**Dependencies:** Phase 4 complete (full pipeline working; cost data available).  
**Risk:** Local LLM tool execution is complex to implement correctly. The tool calling API behavior differs between models. Recommend starting with a subset of tool-safe tasks (bash exec, file write) before enabling for all task types.

---

### Phase 7: Open-Source Extraction (Weeks 22–24)

**Goal:** Extract the most universally useful utilities as standalone, independently publishable npm packages.

**Deliverables:**
See Section 10 for the full extraction plan. Each extraction involves:
1. Remove CAIA-specific dependencies from the utility's core logic
2. Define a clean public API with no internal DB or event bus coupling
3. Add comprehensive documentation (README + JSDoc)
4. Set up independent CI/CD for the package
5. Publish to npm under `@caia/` scope

**Dependencies:** Phase 5 complete (utilities must be stable before extraction).

---

## Section 10: Open Source Strategy

The following utilities have the highest potential as independently useful open-source packages. Viability is assessed on: (1) generality beyond CAIA's specific use case, (2) minimal external dependencies, (3) completeness of the abstraction.

---

### `@caia/event-bus`

**Package name:** `@caia/event-bus`  
**Problem it solves:** A typed, durable, glob-subscribed event bus for Node.js applications. Most applications either use basic EventEmitter (no persistence, no typed events) or heavy message brokers (Kafka, RabbitMQ — massive operational overhead). `@caia/event-bus` fills the middle ground: in-process delivery with SQLite durability, at essentially zero operational cost.  
**Dependencies to shed:** The event type and payload types (which are CAIA-specific) must be parameterized. The `ConductorEvent` type becomes a generic `Event<T>`. The `EventDb` interface is already clean.  
**Standalone interface:**
```typescript
// @caia/event-bus (standalone)
import { createEventBus } from '@caia/event-bus';
const bus = createEventBus<MyEventRegistry>({ dbPath: './events.sqlite' });
bus.publish({ type: 'user.created', payload: { id: '123' }, actor: 'api' });
bus.subscribe('user.*', (event) => console.log(event));
```
**Licensing:** MIT  
**Estimated extraction effort:** 1 week  

---

### `@caia/executor`

**Package name:** `@caia/claude-executor`  
**Problem it solves:** A production-grade executor for `claude --print` (Claude Code headless mode) with: git worktree lifecycle management, circuit breaking on consecutive failures, tiered model selection (Haiku/Sonnet/Opus by task complexity), crash recovery on restart, and structured output parsing. No existing package provides this — every team building on Claude Code reinvents it.  
**Dependencies to shed:** Remove CAIA API calls (replace with injected callbacks). The DB registration (`registerExecutorRun`) becomes an optional hook. The prompt builder should be injectable.  
**Standalone interface:**
```typescript
// @caia/claude-executor (standalone)
import { ClaudeExecutor } from '@caia/claude-executor';
const executor = new ClaudeExecutor({
  worktreeBaseDir: '~/.claude/worktrees',
  maxConcurrent: 3,
  circuitBreakerThreshold: 3,
  onTaskComplete: async (result) => { /* your handler */ },
});
executor.dispatch({ id: 'task-1', title: 'Add login button', cwd: '/my/project', prompt: '...' });
```
**Licensing:** MIT  
**Estimated extraction effort:** 2 weeks  

---

### `@caia/dag-analyzer`

**Package name:** `@caia/task-dag`  
**Problem it solves:** Build, validate, and schedule a directed acyclic graph of AI tasks. Given a list of tasks with `dependsOn` references, produce topological batches for maximum parallelism, detect cycles, and compute the critical path. Broadly useful for any multi-agent workflow orchestration.  
**Dependencies to shed:** Zero external dependencies except TypeScript types. The file-overlap detection is CAIA-specific and should be moved to an extension point.  
**Licensing:** MIT  
**Estimated extraction effort:** 1 week  

---

### `@caia/decomposer`

**Package name:** `@caia/requirement-decomposer`  
**Problem it solves:** Given a natural-language software requirement and project context, use Claude to produce a structured, hierarchical breakdown into independently executable work units. Solves the hardest problem in AI-driven development automation.  
**Dependencies to shed:** The decomposer's output schema (Initiative/Epic/Module/Story) needs to be parameterized for other hierarchical frameworks (e.g. Jira epics/stories/tasks). The project context interface needs generalization.  
**Licensing:** Apache 2.0 (more appropriate for commercial use — encourages adoption while maintaining attribution)  
**Estimated extraction effort:** 3 weeks (after the utility is stable in CAIA)  

---

### `@caia/observability-monitor`

**Package name:** `@caia/pipeline-pulse`  
**Problem it solves:** A three-layer health monitoring system for AI-driven pipelines: synthetic canary (end-to-end task execution), state invariant checks (db consistency), and micro-probes (per-stage health). Includes auto-healing for common failure modes. Currently no standard exists for monitoring AI coding agent pipelines.  
**Dependencies to shed:** The specific check implementations (which hit CAIA's API endpoints) must be made injectable. The canary implementation (which dispatches a real Claude task) must be abstracted.  
**Licensing:** MIT  
**Estimated extraction effort:** 2 weeks  

---

### `@caia/completeness-verifier`

**Package name:** `@caia/completeness-sentinel`  
**Problem it solves:** Verify that AI-generated work is actually complete, not just "completed" in status. Checks: file exists at declared path, URL returns expected status code, test passes, commit SHA is reachable. Prevents the common failure mode of AI agents marking tasks done without evidence.  
**Dependencies to shed:** Already exists as a semi-independent plugin. Needs a clean configuration interface.  
**Licensing:** MIT  
**Estimated extraction effort:** 1 week  

---

### Open-Source Ecosystem Positioning

The recommended sequencing for open-sourcing:

1. **First:** `@caia/event-bus` and `@caia/task-dag` — lowest coupling, immediately useful to the Node.js AI agent community
2. **Second:** `@caia/claude-executor` — highest impact; solves a universal problem for Claude Code users
3. **Third:** `@caia/pipeline-pulse` and `@caia/completeness-sentinel` — operational utilities that complement the executor
4. **Last:** `@caia/requirement-decomposer` — most powerful but most opinionated; wait until the decomposer is proven in production

Each open-source package should be published with:
- A companion blog post explaining the problem and design decisions
- A minimal standalone example (not requiring the full CAIA platform)
- Clear contribution guidelines
- A link back to the CAIA platform as the reference implementation

---

## Appendix A: Database Migration Roadmap

The following new migrations are required beyond the existing 15:

| Migration | Purpose |
|-----------|---------|
| `0016_initiative_kind.sql` | Add `initiative` to `stories.kind` enum |
| `0017_story_enrichment.sql` | Add `enriched_spec_json` and `parallel_batch` columns to `stories` |
| `0018_pull_requests.sql` | New `pull_requests` table for PR tracking |
| `0019_deployments.sql` | New `deployments` table for staging/production deployment records |
| `0020_acceptance_reviews.sql` | New `acceptance_reviews` table for human review decisions |
| `0021_releases.sql` | New `releases` table for production release records |
| `0022_local_llm_routing.sql` | Add `routing_decision` and `local_model` columns to `executor_runs` |

---

## Appendix B: Event Taxonomy Extensions

New events to add to `packages/events-taxonomy/registry.yaml`:

```yaml
# Clarification
- type: prompt.clarification_started
  severity: info
  actor: [clarifier]
  payload: [prompt_id, clarity_score, question_count]

- type: prompt.clarification_completed
  severity: info
  actor: [clarifier, user]
  payload: [prompt_id, answers_count]

# DAG
- type: pipeline.dag_computed
  severity: info
  actor: [dag-analyzer]
  payload: [prompt_id, story_count, parallel_batch_count, critical_path_length]

# PR
- type: pr.created
  severity: info
  actor: [pr-manager]
  payload: [pr_number, pr_url, task_id, head_branch, review_passed]

- type: pr.merged
  severity: info
  actor: [release-manager]
  payload: [pr_number, merge_commit_sha, merged_by]

# Deployment
- type: deployment.started
  severity: info
  actor: [deployment-manager]
  payload: [deployment_id, environment, target, project_slug]

- type: deployment.completed
  severity: info
  actor: [deployment-manager]
  payload: [deployment_id, staging_url, duration_ms, health_check_status_code]

- type: deployment.failed
  severity: error
  actor: [deployment-manager]
  payload: [deployment_id, environment, error]

# Human Acceptance
- type: human.acceptance_requested
  severity: info
  actor: [acceptance-gate]
  payload: [prompt_id, staging_url, pr_url]

- type: human.acceptance_granted
  severity: info
  actor: [user]
  payload: [prompt_id, decided_by, feedback]

- type: human.acceptance_rejected
  severity: warning
  actor: [user]
  payload: [prompt_id, decided_by, feedback, requeue_story_ids]

# Release
- type: release.started
  severity: info
  actor: [release-manager]
  payload: [prompt_id, pr_number]

- type: release.completed
  severity: info
  actor: [release-manager]
  payload: [prompt_id, merge_commit_sha, production_url, release_tag]

# Prompt completion
- type: prompt.completed
  severity: info
  actor: [system]
  payload: [prompt_id, total_duration_ms, total_cost_usd, stories_delivered, files_changed_count]
```

---

## Appendix C: Recommended Third-Party Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| `@octokit/rest` | ^20.0 | GitHub PR creation and management |
| `@libsql/client` | ^0.6 | Turso libSQL multi-user DB |
| `bullmq` | ^5.0 | Redis-backed task queue (optional) |
| `ioredis` | ^5.0 | Redis client for BullMQ |
| `@cloudflare/next-on-pages` | ^1.0 | Dashboard deployment to Cloudflare Pages |
| `wrangler` | ^3.0 | Cloudflare Pages CLI for deployment |
| `@google-cloud/run` | ^0.9 | GCP Cloud Run deployment API |
| `nats` | ^2.0 | NATS messaging (for multi-process event bus) |
| `zod` | ^3.0 | Runtime schema validation for AI outputs |
| `ai` | ^3.0 | Vercel AI SDK (unified interface for Claude + Ollama) |

---

*This document is authoritative for the CAIA platform architecture as of April 2026. It should be updated as implementation decisions are made and phases are completed. All section numbers, utility names, and event types defined here are canonical — use them consistently across code, documentation, and team communication.*
