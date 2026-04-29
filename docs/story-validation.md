# Story Validation

The Story Validator Agent (Tier-4) gates engineering tickets between BA enrichment and Test-Design. It blocks under-specified stories from reaching downstream agents.

This doc covers what the validator checks, how the rubric is structured, what the per-section pass/fail criteria are, what an example "good" vs "bad" story looks like, and what the downstream agents (Testing, Coding) need from a passing ticket.

> **Architecture report:** the full design, research synthesis, retry-loop spec, token cost analysis, and risk register lives at `~/Documents/projects/reports/story-validator-architecture-2026-04-28.md`. Read that first if you need the *why*. This doc is the operator-facing *what* and *how*.

---

## Where it sits in the pipeline

```
prompt → PO → BA → [Validator] → Testing → Task Manager → Coding → Test Runner → done
                       ↑                                                              ↓
                       └──── on validator fail (≤ N-1 attempts) re-invoke BA ────────┘
                                                                                      ↓
                                                       on validator fail at attempt N → escalate
                                                       (file 'validation-stuck' blocker)
```

Stages owned per `apps/orchestrator/src/agents/pipeline-stages.ts`:

- `validated` — Story Validator
- `test_designed` — Testing Agent (TEST-### track)
- `bucket_placed`, `ready_for_pickup` — Task Manager (BUCKET-### track)

The validator advances `prompt_pipeline_stages` to `validated` exactly once per loop run, regardless of how many stories under the prompt pass / fail / escalate.

---

## What the validator checks (six steps)

| # | Step | Type | Cost | Latency |
|---|---|---|---|---|
| 1 | Schema validation | Deterministic (Zod) | $0 | <1ms |
| 2 | Section presence | Deterministic | $0 | <1ms |
| 3 | Detail sufficiency | Deterministic (word counts, sub-field rules, entity refs, forbidden snippets) | $0 | <5ms |
| 4 | Content relevance | LLM-judged (per section) | ~$0.0005–0.002 | ~500ms–2s |
| 5 | Cross-section consistency | LLM-judged (single call) | ~$0.0005–0.001 | ~500ms |
| 6 | Completeness gestalt | LLM-judged (single call) | ~$0.0005–0.001 | ~500ms |

Steps 1–3 are blocking — failure of step 1 means we don't run 2–6. Steps 4–6 produce graded scores; the verdict aggregator decides pass/fail.

LLM steps go through `@chiefaia/local-llm-router` (Ollama-first, Claude-fallback). Three new routing-rule task types: `validation-content-relevance`, `validation-cross-section`, `validation-completeness`.

---

## The rubric (`@chiefaia/ticket-template/validation-rubric.ts`)

The rubric is data-only. The validator agent iterates it. To tune the validator (e.g. tighten a threshold), edit the rubric and bump `RUBRIC_VERSION`. Every `ValidationReport` records the version that scored it, so trend analysis after rubric changes is straightforward.

### Top-level section rules (`TOP_LEVEL_SECTION_RULES`)

| Section | minWords | Forbid snippets | LLM relevance | Severity on fail |
|---|---|---|---|---|
| `scope` | 30 | yes | yes | hard |
| `context` | 0 | no | no | hard |
| `acceptanceCriteria` | 24 (3 ACs × 8 words min) | yes | yes | hard |
| `verificationPlan` | 6 | yes | no | soft |
| `dependencies` | 0 | no | no | warning |

### Per-agent section rules (`AGENT_SECTION_RULES`)

A section is *required* only when the trigger matches the story's taxonomy (a story tagged `qualityTags: ['security']` requires `agentSections.security`; a story whose `lifecycle` is `'new'` requires `agentSections.architecture`).

| Section | Triggered by | minWords | Sub-field rules | Required entity refs | Severity |
|---|---|---|---|---|---|
| `architecture` | `lifecycle ∈ {new, enhance}` | 40 | `constraints ≥ 1` | file path / `ADR-#` / `@chiefaia/*` | soft |
| `database` | `techSubDomains ∋ {database, data-migration, data-pipeline}` | 30 | `schemaChanges ≥ 1` | table name / `migration` keyword | soft |
| `api` | `techSubDomains ∋ {bff, backend, api-gateway}` | 25 | `routes ≥ 1` | — | soft |
| `ui` | `techSubDomains ∋ {frontend, design-system, ui-frontend}` | 25 | `components ≥ 1` | PascalCase component name | soft |
| `security` | `qualityTags ∋ security` ∨ `nature == security` ∨ `risk ∈ {high, critical}` ∨ `techSubDomains ∋ auth` | 30 | `threatModel ≥ 2` | — | soft |
| `testing` | always | 5 | — | — | soft |
| `release` | `risk ∈ {high, critical}` ∨ `qualityTags ∋ compliance` | 20 | — | — | soft |
| `observability` | `qualityTags ∋ observability` ∨ `risk ∈ {high, critical}` | 20 | `metrics ≥ 1` | — | soft |

**`testing` minWords = 5** is intentionally low: testing sections are intrinsically path-heavy (file paths count as one whitespace-separated token each). Three path entries plus `contributedBy` comfortably hit it.

### Acceptance-criteria item rules (`AC_ITEM_RULES`)

- `minWordsPerItem: 8` — filters out one-word stubs like "works".
- `forbiddenSnippets`: `'works correctly'`, `'looks good'`, `'as expected'`, `'should work'`, etc. Triggers a soft-fail with a "non-testable phrasing" finding.
- `bddPatternMinFraction: 0.6` — 60% of AC items should start with `Given|When|Then|It|The system|User|If`. Below 60% ⇒ soft warning. Zero matches ⇒ hard fail.

### Forbidden snippets (universal)

Any string field in any section containing one of these (case-insensitive, word-boundary matched) triggers a `forbidden_snippet` finding:

`TBD, TODO, FIXME, TK, placeholder, to be defined, to be determined, lorem ipsum, see above, fill in later, XXX, WIP`

### Verdict aggregation

| Outcome | nextAction | Trigger |
|---|---|---|
| Pass clean | `proceed` | All deterministic + LLM steps green; score ≥ thresholds |
| Pass with concerns (warnings populated) | `proceed` | Gestalt avg in 3.5–3.99 band |
| Soft fail | `return_to_ba` | Any soft failure; orchestrator re-invokes BA |
| Hard fail | `return_to_ba` (or `escalate`) | Schema invalid or fail on `scope`/`context`/`acceptanceCriteria` |
| Escalate | `escalate` | Attempt counter ≥ `VERDICT_THRESHOLDS.maxAttempts` (default 2) |

Weighted score (0–100): `40% × hard-step-pass-rate + 30% × content-relevance-avg + 15% × cross-section-score + 15% × gestalt-avg`. Score is observability-only, not a gate.

---

## Re-attempt loop (`runValidatorLoop`)

Per story:

```
attempt = 1
while attempt ≤ maxAttempts:
  result = runStoryValidatorAgent(story, attempt)
  if result.passed:
    record pass; advance
    break
  if attempt < maxAttempts:
    runBAAgent(story.requirementId)   # re-enrich
    attempt += 1
  else:
    file 'validation-stuck' blocker
    set validation_status = 'escalated'
    emit story.validation_escalated
    break
```

Capped at 2 attempts (initial + 1 retry). Reflexion-style bounded retry — production best practice (LangGraph, AutoGen) avoids the documented anti-pattern of unbounded retry loops.

The orchestrator-level loop in `runValidatorLoop` advances the prompt's pipeline stage to `validated` exactly once at the end (regardless of per-story outcomes; downstream agents read `validation_status` and skip escalated stories).

---

## Persistence

Migration 0027 adds these columns to `stories`:

| Column | Type | Default | Purpose |
|---|---|---|---|
| `validation_report` | text (JSON) | NULL | Structured `ValidationReport` |
| `validation_status` | text | `'pending'` | `pending` \| `in_progress` \| `passed` \| `failed` \| `escalated` |
| `validation_attempts` | integer | 0 | Number of validator runs |
| `last_validated_at` | integer (epoch ms) | NULL | When the last run completed |

Indexes:

- `story_validation_status_idx` — bucket-placer ready-pool query (only `passed` stories advance to bucket placement).
- `story_validation_attempts_idx` — observability.

---

## Events emitted

Six event types in the canonical taxonomy (`@chiefaia/events-taxonomy-internal`):

| Type | Severity | Actor | Payload |
|---|---|---|---|
| `story.validation_started` | info | `story-validator` | `storyId, promptId, correlationId, attemptNumber, rubricVersion` |
| `story.validation_passed` | info | `story-validator` | `storyId, promptId, correlationId, attemptNumber, score, durationMs, judgeProvider` |
| `story.validation_failed` | warning | `story-validator` | `storyId, promptId, correlationId, attemptNumber, score, failedCheckCount, nextAction, durationMs` |
| `story.validation_escalated` | error | `story-validator` | `storyId, promptId, correlationId, attemptNumber, blockerId` |
| `ticket.validating` | info | `story-validator` | `storyId, promptId, correlationId, attemptNumber` |
| `ticket.validated` | info | `story-validator` | `storyId, promptId, correlationId, score, judgeProvider` |

Plus `pipeline.stage.advanced` for the `validated` stage transition (carries `attemptNumber`, `score`, `judgeProvider` as metadata).

---

## Examples

### Good story (passes validator clean)

```jsonc
{
  "version": "v1",
  "scope": {
    "summary": "Add Google OAuth sign-in button to the dashboard top navigation so unauthenticated users can authenticate via Google and land on the dashboard",
    "inScope": [
      "Render an OAuth sign-in button on the dashboard top nav for unauthenticated users to begin the Google authentication flow end to end"
    ],
    "outOfScope": [
      "Other identity providers such as GitHub or Microsoft are out of scope for this story"
    ]
  },
  "context": {
    "rootPromptId": "prm_xxx",
    "requirementId": "req_xxx",
    "domainPrimary": "auth",
    "domainAll": ["auth", "frontend"],
    "nature": "feature",
    "complexity": "medium"
  },
  "acceptanceCriteria": [
    "Given I am logged out, when I click \"Sign in with Google\", then the OAuth flow begins",
    "Given OAuth succeeds, when the callback returns, then I land on the dashboard signed in",
    "Given OAuth fails, when the callback returns, then I see a clear error message"
  ],
  "verificationPlan": ["pnpm test --filter=auth", "manual smoke against staging"],
  "dependencies": { "upstream": [], "downstream": [], "files": [] },
  "agentSections": {
    "architecture": {
      "contributedBy": "ea-agent",
      "contributedAt": 1777800000000,
      "adrReferences": ["ADR-007"],
      "constraints": ["must reuse the existing session middleware in packages/auth/src/session.ts"],
      "notes": "Approach is to extend the existing session middleware located at packages/auth/src/session.ts so that it accepts Google OAuth tokens in addition to the local password flow. The OAuth client secret is fetched at runtime via @chiefaia/secrets rather than being baked into the bundle."
    },
    "testing": {
      "contributedBy": "testing-agent",
      "contributedAt": 1777800000000,
      "unitTestPaths": ["packages/auth/src/oauth.test.ts"],
      "integrationTestPaths": ["apps/dashboard/tests/oauth-flow.test.ts"],
      "coverageTarget": 0.85
    }
  },
  "metadata": {
    "templateVersion": "v1",
    "poDecomposedAt": 1777800000000,
    "lastUpdatedAt": 1777800000000
  }
}
```

Why it passes:
- All required sections present (scope, context, AC, verification, dependencies, testing).
- 30+ words in scope; 8+ words per AC item; all 3 ACs use BDD phrasing.
- Architecture section has a concrete file-path reference and 40+ words.
- No forbidden snippets anywhere.
- LLM judges return relevance ≥ 4 / consistency ≥ 4 / gestalt ≥ 4 (presupposed; the deterministic checks set the floor for plausibility).

### Bad story (fails validator)

```jsonc
{
  "scope": {
    "summary": "Add OAuth login (TBD details)",     // forbidden snippet "TBD"
    "inScope": ["TBD"],                              // forbidden snippet + insufficient detail
    "outOfScope": []
  },
  "acceptanceCriteria": [
    "It works correctly",                            // 3 words (< 8) + fluff phrasing
    "Should work as expected",                       // fluff phrasing
    "Login flow is correct"                          // fluff phrasing + non-testable
  ],
  "verificationPlan": [],                            // empty (Zod hard-fail)
  "agentSections": {}                                // testing section missing (always required)
}
```

Why it fails (deterministic):
- `scope` contains "TBD" (forbidden snippet, hard fail).
- `acceptanceCriteria[0]` is < 8 words.
- All 3 ACs contain fluff phrases.
- 0% BDD-pattern matches → hard fail.
- Required `testing` section missing.
- `verificationPlan` empty → Zod schema fail.

The Validator's `failedChecks` would surface each finding with a `fixSuggestion`; the orchestrator would re-invoke BA with this report as feedback and retry.

---

## What downstream agents need from a passing ticket

### Testing Agent (TEST-### track)

Reads:
- `acceptanceCriteria` — every item becomes one or more concrete test cases.
- `agentSections.testing.unitTestPaths` / `integrationTestPaths` — guides where tests should live.
- `agentSections.testing.coverageTarget` — sets the coverage gate.
- `scope.summary` + `agentSections.architecture.notes` — context for naming and grouping cases.

The Validator's `completenessGestalt.testingAgentReady` score is *the* signal that this metadata is sufficient. Below 4/5 ⇒ Testing Agent will likely struggle.

### Coding Agent (Phase 2 future)

Reads:
- `agentSections.architecture` — design decisions and constraints.
- `agentSections.api.routes` — explicit HTTP contracts to implement.
- `agentSections.database.schemaChanges` + `migrationPath` — schema work.
- `agentSections.ui.components` + `designSystemPattern` + `accessibilityRequirements`.
- `dependencies.files` + `claims.files` — files the implementation will touch.

The Validator's `completenessGestalt.codingAgentReady` score is *the* signal here. Below 4/5 ⇒ Coding Agent will need follow-up clarification.

---

## Operator runbook

### "How do I see why a story was escalated?"

The dashboard's `/stories/[id]` page renders the `ValidationReport` panel: per-step pass/fail, failed-check list with section + ruleId + message + fix suggestion, and the Validator's `score`. Live updates land via the `story.validation_*` WS event subscriptions.

The escalation also files a `validation-stuck` blocker visible on `/blockers`. The blocker's `description` field has the failure summary; `resolutionSteps` lists the validator's `fixSuggestions`.

### "The validator is too strict — how do I tune it?"

Edit `packages/ticket-template/src/validation-rubric.ts`:

- Want a section to be optional? Adjust its `trigger`.
- Want to lower the bar for word counts? Adjust `minWords`.
- Want to allow a phrase that's currently forbidden? Edit `UNIVERSAL_FORBIDDEN_SNIPPETS` or the section's `extraForbiddenSnippets`.
- Want to relax the LLM-judge threshold? Edit `VERDICT_THRESHOLDS.contentRelevanceMinAvg` / `.crossSectionMinScore` / `.gestaltMinReady`.

Then bump `RUBRIC_VERSION = 'v1'` to `'v2'` so trend analysis can compare runs scored against different rubrics. Add a row to the migration journal if you ship a backfill script.

### "Why isn't the validator using my new local model?"

Routing config: `packages/local-llm-router/src/routing-config.ts`. Add or edit the rule for `validation-content-relevance`, `validation-cross-section`, or `validation-completeness`. Set `useLocal: true` and the `localModel` to your model.

Until a routing rule exists for these task types, the router falls back to the default Claude rule. The validator emits `judgeProvider` in its `ValidationReport` so you can audit which provider answered each call.

### "How do I disable the validator entirely?"

Comment out the `runValidatorLoop` call in `apps/orchestrator/src/agents/scaffolder.ts` (between the BA and Test-Design `.then()` blocks). Stories will then go straight from BA to Test-Design with no quality gate. *Do not do this in production.*

---

## Performance

Per story, typical (one validation run):

- Steps 1–3: ~5ms total (deterministic).
- Steps 4–6: parallel (Promise.all). Local-routed: ~1.5s. All-Claude: ~3s.
- Total: ~1.5s local-routed; ~3s Claude-only.

At the projected pipeline rate (100 stories/day baseline; 1000/day post-LAI):

- Local-routed: $0.05/day → $1.50/month.
- All-Claude: $0.80/day → $24/month.

LAI-track local-quality improvements reduce ~85% of cost; without LAI we still have a working validator at modest cost.

---

## Related work

- **TEST-###**: the Testing Agent that consumes validated stories. Their `test_designed` stage sits immediately after `validated` in the pipeline order.
- **BUCKET-###**: the Task Manager that places validated + test-designed stories into per-`(project, primary_tech_sub_domain)` buckets. Their bucket-placer reads `validation_status` from the story row and skips anything not `passed`.
- **LAI-###**: local-AI throughput improvements. As LAI ships better local judges, the validator's routing rules will flip more steps to local.
