# `@caia/business-proposal-generator`

Stage 5 of the canonical CAIA pipeline. Takes the Interviewer's
`BusinessPlanV2` (score ≥ 80) plus the IA Agent's three artifacts and
emits three Markdown documents (exec summary, full proposal, one-pager),
their PDF + DOCX conversions, and a per-target design-app prompt that
has been graded by the Prompt Reviewer.

```
Stage 3   @caia/interviewer                  → BusinessPlanV2
Stage 4   @caia/info-architect (in-flight)   → 3 IA artifacts (mirrored)
Stage 5   @caia/business-proposal-generator  ← THIS PACKAGE
            FSM: interview-complete → proposal-generated
Stage 6   customer designs externally
```

## Surface

```ts
import {
  ProposalGenerator,
  MemoryProposalPersistence,
  MemoryBlobStorage,
  ScriptedLlmCaller,
} from '@caia/business-proposal-generator';

const generator = new ProposalGenerator({
  blobStorage: new MemoryBlobStorage(),
  persistence: new MemoryProposalPersistence(),
  skillsRoot: '<path-to-this-package>/skills',
  llmCaller,
});

const result = await generator.runStep5({
  tenantProjectId,
  plan,           // BusinessPlanV2 from @caia/interviewer
  ia,             // PagesCatalogue + DesignSystem + ComponentsLibrary
  designAppTarget: 'claude_design',
});
```

## Per-target generators

| Target | V1 status |
|---|---|
| `claude_design` | **Locked V1** — golden-test gated |
| `figma` / `v0` / `lovable` / `bolt` / `builderio` / `webflow` | Stubs (typed `NotImplementedError`) with SKILL.md authored |

Per spec §3.3, the registry is an explicit extension surface
(`IUxSourceAdapter` precedent). Adding a new target = one new SKILL.md +
one new generator class + one `registry.register(...)` call.

## Storage

Three immutable per-tenant tables (`business_proposals`,
`designapp_prompts`, `proposal_revisions`). Migration template at
`migrations/0001_business_proposals.sql` with `{{SCHEMA}}` substitution.
`LISTEN/NOTIFY` trigger fires `business_proposal_ready` on insert.

## Pandoc

The package shells out to `pandoc` for Markdown → PDF (with
`templates/proposal.tex`) and Markdown → DOCX. The `pandoc` binary
must be on `$PATH` — `PandocNotFoundError` is raised cleanly
otherwise. Tests inject a stub `PandocRunner`.

## Subscription-only

All `spawnClaude` calls pass `rejectIfApiKeyPresent: true`. No
API-key escape hatch.

## Tests

```
pnpm --filter @caia/business-proposal-generator test
```

≥ 40 vitest cases; ≥ 80% coverage via `@chiefaia/vitest-config` defaults.
