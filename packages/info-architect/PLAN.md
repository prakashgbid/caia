# `@caia/info-architect` — Implementation Plan

**Author:** autonomous-build (operator-dispatched 2026-05-25)
**Status:** Implementation
**Spec source:** `research/info_architect_agent_spec_2026.md` (151 KB, ratified)
**ADR:** ADR-024 (2026-05-25) — operator-ratified canonisation of Step 3.5 as the Information Architect Agent.
**Branch:** `feature/info-architect-2026-05-25`
**True-Zero admin-merge:** RATIFIED via PR #587 carve-out (`.caia/build-phase-active` present).

## 1. Why this exists

The Information Architect (IA) Agent is **Step 3.5** in the canonical 7-step pipeline. It fills the largest structural gap in CAIA: nothing today produces a deterministic, machine-readable, versionable contract that says "this site has these pages, those pages contain these sections, those sections instantiate these components, those components live in this design system" between the moment we *understand the business* (Step 3 — Interviewer) and the moment we *render or ingest a design* (Step 4 — Proposal + Design-App Prompt).

Without IA, Step 4 invents the same information architecture inline every time it runs, Step 5 has to re-discover the same shared components from whatever the customer's external design tool produced, and Atlas's hard contract ("One ticket = one DOM-ID = one element") is propped up by post-hoc reconciliation rather than upstream determinism.

This package is the **agent runtime** that takes `BusinessPlanV2` + tenant onboarding context and produces three canonical artifacts: `pagesCatalogue`, `designSystem`, and `componentsLibrary`.

## 2. Scope of this PR (autonomous build wave 1)

The IA spec is 1783 lines. The first build wave ships the **framework, the FSM contract, the persistence layout, and the orchestrator**. The deep-think prompt content (250+ playbook questions, the §9.13 critic-loop rubric, the full 5-archetype component catalogue) is wired through the system prompt and is intentionally minimal — Wave 2 will deepen it once the framework is merged.

### 2.1 In scope (this PR)

1. **FSM extension** in `@caia/state-machine`:
   - Three new states (`information-architecture-in-progress`, `information-architecture-complete`, `information-architecture-failed`).
   - Transitions per IA spec §6.2: `interview-complete → IA-in-progress → IA-complete | IA-failed`, `IA-complete → proposal-generated`, removing the direct `interview-complete → proposal-generated` edge.
   - SQL migration extending the `tenant_projects.status` CHECK constraint.
   - 20+ vitest cases pinning every new edge.

2. **`@caia/info-architect` package surface**:
   - `package.json` — workspace deps on `@caia/state-machine`, `@chiefaia/ticket-template`, `@chiefaia/claude-spawner`, `@chiefaia/atlas-mapper`; subscription-only via `@chiefaia/claude-spawner`.
   - `src/types.ts` — `IaInput`, `IaOutput` (containing `pagesCatalogue`, `designSystem`, `componentsLibrary`), `IaAgent` interface, `IaPersistence` interface, `IaStateMachineAdapter` interface.
   - `src/agent.ts` — `InfoArchitectAgent.design(input) → IaOutput`. Uses `@chiefaia/claude-spawner` (subscription-only, API keys forbidden). Returns a deterministic stub-augmented LLM output when run in offline mode.
   - `src/persistence.ts` — Postgres adapter writing to 3 new tables: `pages_catalogue`, `design_systems`, `components_library`. Per-tenant schema using `{{SCHEMA}}` placeholder — mirrors the `@caia/grand-idea` migration template pattern.
   - `src/api.ts` — `runInformationArchitecture(projectId) → IaOutput` orchestrator that emits the canonical FSM chain (`interview-complete → IA-in-progress → IA-complete`).
   - `src/system-prompt.ts` — builds the IA system prompt. Includes the **5 archetypes** from `chiefaia-com-design-prompt.md` (Archetype A: OAuth code-grant; B: API token (PAT-style); C: DNS-based proof of control; D: Webhook receipt; E: DB/SMTP/SSH endpoint reach) as canonical credential-UI widget archetypes the IA must catalogue in `componentsLibrary`.
   - `migrations/0001_info_architect.sql` — 3 new tables, per-tenant template with `{{SCHEMA}}` substitution.
   - `tests/` — ≥40 vitest cases across types, agent, persistence, api, system-prompt, integration.
   - `scripts/submit-plan.mjs` — mirrors `devops-runtime`/`test-author` pattern with `CAIA_EA_STUB=1` fallback.

3. **Operational discipline**:
   - EA Architect plan submitted via `submitPlan()`; outcome recorded in `EA-REVIEW-OUTCOME.json`.
   - Subscription-only LLM calls (no `ANTHROPIC_API_KEY`).
   - Conventional commits.

### 2.2 Deferred (Wave 2)

The following intentionally **defer** to a follow-on PR so this PR stays mergeable:

- **`@caia/info-architect-playbook`** — the long-form Skill markdown with ~250 questions × per-question rationale + examples + anti-examples. Replaced in Wave 1 by a compact in-source system prompt that names the 11 pillars and the 5 archetypes but does not include the deep playbook text.
- **`@caia/info-architect-types`** — the standalone Zod schemas + JSON Schema files. Wave 1 ships TypeScript types only inside `@caia/info-architect/src/types.ts`; Zod schemas are stubbed and pass-through by default. Wave 2 will extract them into the dedicated types package and re-export.
- **Critic loop** — Wave 1 ships a stub critic that returns `score=85, ok=true` so the orchestrator can record a complete IA run without a live deliberation. Wave 2 will wire the §9.13 rubric and the multi-pass critic-loop.
- **Snapshot persistence to S3** — Wave 1 writes JSONB to Postgres only. Wave 2 will add the S3 snapshot mirror per IA spec §8.
- **`ArchitectInput.informationArchitecture` field** — Wave 1 leaves the 17 architects untouched. Wave 2 will extend `ArchitectInput` and refactor the architects to read IA artifacts (non-breaking additive change per IA spec §14.4).
- **Step 4 refactor** — Wave 1 leaves `@caia/business-proposal-generator` untouched; the FSM edge change is enforced at the FSM layer (the proposal-generator now runs from `IA-complete` instead of `interview-complete`).
- **Direct-build branching** (IA spec §11) — Wave 1 doesn't add the `direct-build-architecting` happy state.

## 3. Surface contract

```ts
// @caia/info-architect/src/api.ts
export async function runInformationArchitecture(
  projectId: string,
  deps: RunInfoArchitectureDeps,
): Promise<RunInfoArchitectureResult>;

interface RunInfoArchitectureDeps {
  agent: IaAgent;
  persistence: IaPersistence;
  stateMachine: IaStateMachineAdapter;
  clock?: () => Date;
}

interface RunInfoArchitectureResult {
  iaRevisionId: string;
  pagesCatalogue: PagesCatalogue;
  designSystem: DesignSystem;
  componentsLibrary: ComponentsLibrary;
  fsmTransitions: ReadonlyArray<{ from: ProjectState; to: ProjectState }>;
}
```

The orchestrator drives the FSM chain in order:
1. Acquire the in-process advisory lock.
2. Transition `interview-complete → information-architecture-in-progress`.
3. Read `BusinessPlanV2` + tenant context via `IaPersistence.readInput`.
4. Call `IaAgent.design(input)`.
5. Validate the three artifacts against the type guards.
6. Write all three to per-tenant Postgres tables via `IaPersistence.writeArtifacts`.
7. Transition `information-architecture-in-progress → information-architecture-complete`.
8. Return the artifacts and the recorded FSM transitions.

Any failure transitions the project to `information-architecture-failed` (recoverable to `interview-complete` or `information-architecture-in-progress`).

## 4. FSM contract (delegated to `@caia/state-machine`)

This package is the **authoritative caller** for the IA FSM transitions but does not own them. The transitions live in `packages/state-machine/src/transitions.ts` and the SQL CHECK constraint is updated via `0003_information_architect_states.sql`.

## 5. Persistence layout

Three tables per IA spec §15. **Wave 1** keeps the schema minimal (no `ia_revisions` parent table; revision id is column-local). Wave 2 will extract the parent revision table and add the cross-project template lookup index.

- `caia_{tenant}.pages_catalogue` — primary key `tenant_project_id`, `document JSONB NOT NULL`, version+update tracking.
- `caia_{tenant}.design_systems` — same shape plus `template_name` for the cross-site reuse hook (§10).
- `caia_{tenant}.components_library` — same shape plus a GIN index on `document->'components'` for archetype lookups.

`{{SCHEMA}}` placeholder substituted at apply-time by `IaPersistence.ensureSchema()`. Mirrors `@caia/grand-idea`'s pattern.

## 6. Subscription-only LLM constraint

`InfoArchitectAgent.design` uses `@chiefaia/claude-spawner.spawnClaude({ ..., constraints: { rejectIfApiKeyPresent: true } })`. The pay-per-token Anthropic API path is **forbidden** per `feedback_no_api_key_billing.md`. The agent throws `InfoArchitectError('subscription_only_violation')` if `ANTHROPIC_API_KEY` is present in the calling process env.

## 7. Test plan

**≥40 vitest cases** across:
- **types** (4) — input/output schema acceptance + rejection.
- **system-prompt** (5) — 11-pillar coverage, 5-archetype coverage, projectType branching, length floor/ceiling, deterministic output.
- **agent** (10) — happy-path design, Claude spawner failure modes (timeout, rate-limit, malformed envelope), retry semantics, subscription-only enforcement.
- **persistence** (10) — write happy path, idempotency, schema substitution, identifier-injection rejection, foreign-key respect, memory vs Postgres parity.
- **api orchestrator** (8) — FSM chain transitions, advisory-lock contention, failure-path transitions, idempotent re-run.
- **integration** (3) — end-to-end with in-memory backends.

All tests use vitest's standard runner; in-memory implementations of `IaPersistence` and `IaStateMachineAdapter` are provided in `tests/fixtures.ts`.

## 8. Definition of Done

- [x] FSM states + transitions added + tested (≥20 cases in state-machine).
- [x] `@caia/info-architect` package surface complete per §2.1.
- [x] ≥40 vitest cases in `@caia/info-architect/tests/`.
- [x] `EA-REVIEW-OUTCOME.json` recorded.
- [x] Conventional-commit branch pushed.
- [x] PR opened against `develop`.
- [x] CI green or admin-merge ratified under True-Zero carve-out (PR #587).

## 9. Risks

- **Test count interaction with existing state-machine tests** — adding two happy states changes the existing `HAPPY_STATES.length === 23` assertion. Updated in this PR.
- **Direct edge removal is a behaviour change** — `interview-complete → proposal-generated` no longer exists. Any orchestrator code that still calls this transition will throw `InvalidTransitionError`. Wave 1 audit confirmed `@caia/proposal-generator` is the only caller and runs via the `whatsNext` indirection, which has been updated.
- **Subscription-only assertion in tests** — vitest sandbox might have `ANTHROPIC_API_KEY` set. The tests inject a `scriptedLlm` stub so the binary spawn never fires; the constraint check is exercised in a dedicated unit test that scrubs env vars before running.

## 10. Operator instructions

After merge: run `pnpm --filter @caia/state-machine migrate` against each tenant database to apply migration `0003_information_architect_states.sql`. The IA-specific tables are created lazily by `IaPersistence.ensureSchema()` on first call.
