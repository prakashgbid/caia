# `@caia/business-proposal-generator` — Stage 5 Implementation Plan

**Submitted for EA Architect review.** Per CAIA convention, this plan is
written to disk under the package it describes and submitted via
`@caia/ea-architect` `submitPlan` before implementation begins.

**Date:** 2026-05-25
**Stage:** 5 — Business Proposal + Design-App Prompt Generation
  (operator pipeline numbering; matches **Step 4** in
  `research/step4_proposal_and_designapp_prompt_spec_2026.md` — the
  operator's numbering counts the IA Agent as Stage 4.)
**Spec sources (canonical):**
- `research/step4_proposal_and_designapp_prompt_spec_2026.md` — primary spec
- `research/step3_interviewer_agent_v2_spec_2026.md` — upstream business plan contract
- `packages/interviewer/` — convention template
- `packages/state-machine/src/transitions.ts` — FSM advance `interview-complete → proposal-generated`

## 1. Intent

Stage 5 of the canonical CAIA pipeline. Takes (a) the Interviewer's
`BusinessPlanV2` (score ≥ 80) and (b) the IA Agent's three artifacts
(mirrored locally as Zod schemas; see Risk #2) and emits:

1. **Three Markdown source documents per revision**: executive summary
   (≤ 400 words), full proposal (10–30 pages), one-pager (1 page).
2. **Multi-format conversions** of all three: Markdown → PDF (pandoc +
   locked LaTeX, per `pdf` skill) and Markdown → DOCX (pandoc + reference
   docx, per `docx` skill).
3. **One design-app-targeted prompt** for the tenant's chosen target:
   **CD ZIP** locked V1; Figma / v0 / Lovable / Bolt / Builder.io /
   Webflow as stubs behind the same `IDesignAppPromptGenerator`.
4. **A Prompt Reviewer critique** (six-dimension rubric, 0–100, ship at
   ≥ 70, one retry, second-failure ships with `'caution'` per spec §4.2).
5. **Three Postgres rows** in the per-tenant schema: `business_proposals`,
   `designapp_prompts`, `proposal_revisions` — all immutable.

## 2. Pipeline position

```
Stage 3   @caia/interviewer                  → BusinessPlanV2
Stage 4   @caia/info-architect (in-flight)   → 3 IA artifacts
Stage 5   @caia/business-proposal-generator  ← THIS PACKAGE
            FSM: interview-complete → proposal-generated
Stage 6   customer designs externally
Stage 7   @caia/intake + Atlas               → ingest design
```

The FSM transition is already enumerated in
`packages/state-machine/src/transitions.ts`.

## 3. Reused artifacts (DO NOT re-invent)

| Source | Reuse |
|---|---|
| `@caia/interviewer` | `BusinessPlanV2`, `businessPlanV2Schema`, `BUSINESS_PLAN_SECTIONS`, `getSection()` |
| `@caia/info-architect` (mirrored) | Three IA artifact Zod schemas, annotated `// MIRROR — swap when upstream merges` |
| `@chiefaia/claude-spawner` | `spawnClaude` + `parseClaudeJsonEnvelope` — subscription-only |
| `pdf` skill | MD → PDF |
| `docx` skill | MD → DOCX |
| `packages/interviewer/migrations/0001_interviewer.sql` | `{{SCHEMA}}` template pattern |
| `packages/interviewer/src/llm.ts` | `DefaultLlmCaller` + `ScriptedLlmCaller` pattern |
| `@caia/state-machine` | FSM transition |

## 4. Module surface

```
caia/packages/business-proposal-generator/
├── EA-PLAN.md
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.cjs
├── migrations/0001_business_proposals.sql
├── templates/proposal.tex
├── templates/proposal-reference-docx.md
├── skills/
│   ├── claude-design/SKILL.md
│   ├── claude-design/template.md
│   ├── claude-design/examples/README.md
│   ├── figma/SKILL.md
│   ├── v0/SKILL.md
│   ├── lovable/SKILL.md
│   ├── bolt/SKILL.md
│   ├── builderio/SKILL.md
│   └── webflow/SKILL.md
├── src/
│   ├── index.ts
│   ├── types/{index,ia,proposal,design-app,reviewer}.ts
│   ├── proposal/{render-exec-summary,render-full,render-one-pager,word-count,prompts}.ts
│   ├── conversion/{markdown-to-pdf,markdown-to-docx,pandoc}.ts
│   ├── design-app/{registry,generator-interface,envelope,deep-links}.ts
│   ├── design-app/targets/{claude-design,figma,v0,lovable,bolt,builderio,webflow}.ts
│   ├── reviewer/{prompt-reviewer,rubric}.ts
│   ├── storage/{postgres,blob,memory-blob}.ts
│   ├── orchestrator.ts
│   ├── revisions.ts
│   ├── llm.ts
│   └── errors.ts
└── tests/                              # ≥ 40 cases + smoke
```

## 5. Algorithm — `runStep5(input)`

Mirrors §3.4 of the spec:

1. Validate `BusinessPlanV2` + assert `aggregateScore ≥ 80`. Validate IA.
2. `business_plan_hash = sha256(canonicalJson(plan, sorted))` (RFC-8785 JCS).
3. Cache hit if hash matches latest revision — return that revision, no
   LLM calls, no Postgres writes.
4. Three sequential LLM calls:
   - `renderExecSummary` (≤ 400 words enforced)
   - `renderFull` (heading + word-count bounds enforced)
   - `renderOnePager` (≤ 320 words enforced)
5. Deterministic pandoc → 3 PDFs + 3 DOCXs. Bubble `PandocError`.
6. Look up `tenant.designAppTarget` (default `claude_design`).
7. Spawn one LLM call to target generator (CD V1; stubs throw
   `NotImplementedError(<target>)`).
8. Spawn one LLM call to Prompt Reviewer (six-dimension rubric).
9. If composite < 70: one retry of step 7 with findings as feedback;
   second failure ships with `'caution'` per spec §4.2.
10. Insert one row each into `business_proposals`, `designapp_prompts`
    (prior `superseded_by` updated same tx), `proposal_revisions`.
11. Advance FSM `interview-complete → proposal-generated` (idempotent).
12. Return `GenerationResult`. SSE wake-up via the migration's
    `LISTEN/NOTIFY` trigger, not from the orchestrator.

## 6. Per-target generator catalogue — V1 scope

| Target | V1 status | Companion files |
|---|---|---|
| `claude_design` | **Locked V1 — golden-test gated** | none |
| `figma` | Stub + SKILL.md + envelope test | `figma_tokens.json` (future) |
| `v0` | Stub + SKILL.md + envelope test | none |
| `lovable` | Stub + SKILL.md + envelope test | none |
| `bolt` | Stub + SKILL.md + envelope test | `package.json` (future) |
| `builderio` | Stub + SKILL.md + envelope test | `builder.json` (future) |
| `webflow` | Stub + SKILL.md + envelope test | `webflow_style_guide.json` (future) |

Framer + Anima not in user's Package 2 scope.

## 7. Anthropic primitive choices

- **Subagent for the generator** — bounded transformation, leanest primitive.
- **Skill per target** — declarative, target-specific, edited often.
- **No tools inside generator subagents** — skill bakes intake at load time.

## 8. Tests (≥ 40 required; ~48 expected)

- `revisions.test.ts` × ~5
- `proposal/word-count.test.ts` × 4
- `proposal/render-*.test.ts` × ~6 (ScriptedLlmCaller)
- `conversion/*.test.ts` × ~5
- `design-app/envelope.test.ts` × ~5
- `design-app/registry.test.ts` × 3
- `design-app/deep-links.test.ts` × 7
- `design-app/claude-design.golden.test.ts` × 4 (similarity ≥ 0.85)
- `design-app/stubs.test.ts` × 6 (NotImplementedError shape)
- `reviewer/rubric.test.ts` × ~5
- `reviewer/prompt-reviewer.test.ts` × ~4
- `storage/blob.test.ts` × 3
- `storage/postgres.test.ts` × ~3
- `orchestrator.test.ts` × ~5

Coverage ≥ 80%. Smoke: migration applies cleanly; public surface imports.
No-secret-leak invariant.

## 9. Postgres migration — `0001_business_proposals.sql`

Three tables per spec §1.3 with `{{SCHEMA}}` substitution. `LISTEN/NOTIFY`
trigger on `business_proposals` insert.

## 10. Parameterised public API (Option E)

```ts
const generator = new ProposalGenerator({
  llmCaller, blobStorage, pgPool, tenantSchema,
  skillsRoot, templatesRoot, pandocBinary, clock,
});
```

No hard-coded paths.

## 11. Subscription-only enforcement

All `spawnClaude(...)` calls pass `constraints: { rejectIfApiKeyPresent: true }`.

## 12. Risks

1. Golden LLM-output tests flaky → only CD uses similarity gate; stubs
   use contract tests.
2. `@caia/info-architect` not merged → mirrored Zod schemas with swap path.
3. `@caia/byo-cloud` doesn't exist → `IBlobStorage` interface + in-memory
   impl; cloud impls later.
4. Pandoc runtime dep → `PandocNotFoundError` surfaced; no silent fallback.
5. Stubs explicit (typed `NotImplementedError`), not silent.

## 13. Definition of done

- `pnpm --filter @caia/business-proposal-generator typecheck` clean
- `test` green (≥ 40 tests, ≥ 80% coverage)
- `lint` clean
- prakash-tiwari fixture: 3 MD + 3 PDF + 3 DOCX + 1 CD prompt; one row
  each in 3 tables; reviewer score ≥ 70
- Cache-hit verified
- Smoke tests pass
- PR to `develop`; admin-merged per True-Zero

---

## EA Review request

Reviewer: please verify:

(a) The package boundary (one runtime + one migration + skills tree +
    explicit-stub registry) — neither over-decomposed (separate
    `@caia/designapp-prompt-generator` per spec §3.4 split) nor
    under-decomposed (folding into `@caia/interviewer`). The user's
    brief consolidates spec §3.4's two halves into one package.
(b) Mirroring `@caia/info-architect` types locally is the right interim
    move given upstream is not yet merged.
(c) The pluggable target registry matches the `IUxSourceAdapter` precedent.
(d) The non-blocking Prompt Reviewer posture doesn't violate any standing
    DoD rule.
(e) Calling `@caia/state-machine.transition` from inside `runStep5` is
    the right coupling.

No new ADRs requested. No existing ADRs amended.
