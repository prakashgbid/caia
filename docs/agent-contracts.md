# Agent Section Contract Registry

> **Status:** ACR-001..010 shipped 2026-04-28. ACR-007 (Validator refactor to consume composed templates) gated on VAL-### track merging.

## Why this exists

Each Phase-1 ticket-writing agent — **PO, BA, EA, Test-Design** — owns specific sections of the canonical `TicketTemplateV1`. Before this registry, the Story Validator carried a hard-coded master rubric (`packages/ticket-template/src/validation-rubric.ts`) that knew about every section and severity. Adding a new agent meant editing the master schema and the validator together — brittle and tightly coupled.

The Agent Section Contract Registry inverts that: each agent **declares** what sections it populates, with descriptions, per-scope rubrics, dependencies, and good/bad examples. The Story Validator **composes** all registered contracts at runtime per a story's `story_scope`. Adding a new agent means dropping a `*.contract.ts` file and registering it — no Validator change.

End state: every story is **self-sufficient, stateless, context-less**. Test-Design + coding agents get everything from the ticket alone. No follow-up questions, no implicit defaults.

## Mental model

```
PO Agent ─┐
BA Agent ─┤   register on import
EA Agent ─┤  ───────────────►  ContractRegistry  ───────►  composeTemplate(scope)
Test-Design ┘                                                        │
                                                                     ▼
                                                           Story Validator
                                                                     │
                                                                     ▼
                                                           per-section findings
                                                           (severity + fixHint
                                                            + LLM relevance)
```

A `SectionContract` is the agent's promise: "I will populate these sections, validated to these rubrics, at these scopes." A `ComposedTemplate` is the union of all promises filtered to a single scope.

## Type system

All types live in `@chiefaia/ticket-template/src/section-contract.ts` and re-export from the package root.

```typescript
type StoryScope =
  | 'initiative'  // strategic bet, multi-quarter, portfolio
  | 'epic'        // ART-level grouping, multi-PI
  | 'module'      // bounded context (DDD)
  | 'story'       // sprintable user-value unit (canonical)
  | 'task'        // self-contained, one-coder/one-bucket
  | 'subtask';    // smallest atomic step

type AgentRole = 'po' | 'ba' | 'ea' | 'test-design';

interface SectionContract {
  ownerAgent: AgentRole;
  contractId: string;       // e.g. 'po-agent.v1'
  version: string;          // bump on rubric/spec changes
  appliesTo: readonly StoryScope[];
  sections: readonly SectionSpec[];
}

interface SectionSpec {
  name: string;             // dotted path, e.g. 'agentSections.api'
  description: string;
  purpose: string;
  dataShape: ZodTypeAny;
  required: boolean;
  rubric: SectionRubric;
  dependencies?: readonly string[];
  examples: readonly SectionExample[];
  scopeOverrides?: Partial<Record<StoryScope, Partial<SectionRubric> & { required?: boolean }>>;
}

interface SectionRubric {
  minWords?: number;
  minItems?: number;
  minItemsPerSubField?: Record<string, number>;
  requiredSubFields?: string[];
  requiredEntityRefs?: Array<{ label: string; pattern: string; flags?: string }>;
  forbiddenSnippets?: string[];
  relevancePromptSeed?: string;
  severityOnFail: 'hard' | 'soft' | 'warning';
  fixHint: string;
}
```

## Composition algorithm

`composeTemplate(scope, opts?)` lives in `@chiefaia/agent-contract-registry`:

1. Filter the registry to contracts whose `appliesTo` includes `scope`.
2. Sort by **agent-pipeline order** — PO < BA < EA < Test-Design. Tie-break alphabetically by `contractId`.
3. Iterate sections; the **first contract to claim a section name wins**. Subsequent claims log a warning (or throw in `strict` mode).
4. Apply per-section `scopeOverrides[scope]` via shallow merge to compute effective rubric + required.
5. Verify each section's `dependencies` resolve within the composed template; warn for unresolved.
6. Compute a stable SHA-256 `signature` for cache keying + drift detection.

The composition is pure — zero LLM calls. Validator caches one `ComposedTemplate` per scope per process; cache invalidates only on registry mutation.

**Conflict resolution:** PO wins if PO and EA both claim `taxonomy.project`. CI runs `composeTemplate(scope, { strict: true })` for every scope so accidental overlap fails the build.

## Per-scope expected sections

The matrix below is the authoritative initial expectation per the architecture report:

| Section | initiative | epic | module | story | task | subtask | Owner |
|---|---|---|---|---|---|---|---|
| `scope` | x (80w) | x (50w) | x | x | x | x (10w) | PO |
| `context.userPersona` | x (12w) | x (8w) | — | x | — | — | PO |
| `taxonomy.lifecycle` | warn | x | x | x | x | x | PO |
| `taxonomy.priorityBucket` | x | x | x | x | x | warn | PO |
| `linksToJson` (FREG matches) | warn | warn | warn | warn | warn | warn | PO |
| `context.parentEpic` | — | soft | soft | soft | soft | hard | PO |
| `taxonomy.project` | warn | soft | soft | soft | soft | warn | PO |
| `taxonomy.businessSubDomains` | x | x | x | x | — | — | PO |
| `businessOutcome` (KPIs) | x (60w) | x (30w) | — | — | — | — | PO |
| `acceptanceCriteria` | — | x (2,16w) | x (2,16w) | x (3,24w) | x (1,8w) | warn | BA |
| `agentSections.{api,db,ui,sec,test,rel,obs}` | — | — | — | soft | soft | — | BA |
| `dependencies` | — | warn | warn | warn | warn | — | BA |
| `risks` | x | x | x | soft | — | — | BA |
| `assumptions` | x | x | x | warn | — | — | BA |
| `clarifyingQuestions` | — | — | — | warn | warn | — | BA |
| `agentSections.architecture` | — | — | x soft | x soft | x soft | — | EA |
| `architecturalInstructions` (ARCH-006) | — | — | x soft | x soft | x soft | — | EA |
| `taxonomy.techSubDomains` | — | — | x hard | x hard | x hard | warn | EA |
| `claims` (scheduler) | — | — | soft | x soft | x soft | — | EA |
| `taxonomy.effort` | — | warn | soft | soft | soft | warn | EA |
| `taxonomy.risk` | — | warn | soft | soft | soft | warn | EA |
| `testCases` | — | — | — | x hard (3) | soft (1) | — | Test-Design |
| `testDesign` | — | — | — | x soft | optional | — | Test-Design |

## Adding a new agent

1. Create `apps/orchestrator/src/agents/my-agent.contract.ts`. Export a `SectionContract` constant.
2. Add the contract to `PHASE1_CONTRACTS` in `apps/orchestrator/src/agents/contract-bootstrap.ts`.
3. Write a per-contract test in `apps/orchestrator/tests/agents/my-agent.contract.test.ts`. Mirror the pattern from `po-agent.contract.test.ts` — assert registration, ownership, scope filter, and per-scope effective rubrics.
4. The Validator picks up your contract automatically on next boot. The dashboard `/contracts` page renders it without code changes.

## Operator surfaces

- **Dashboard `/contracts`** — pick a scope, see every section with owner + severity + min-words + dependencies + fix hint. See every registered contract with version + applies-to.
- **`GET /api/contracts/registry`** — JSON listing.
- **`GET /api/contracts/composed/:scope`** — composed template per scope.
- **`GET /api/contracts/composed-all`** — per-scope summary (signature + sectionCount).

## Validator integration (ACR-007 — gated)

ACR-007 lands the swap from `validation-rubric.ts` to runtime composition. Sequencing:

1. **Step A** — adapter `toValidationRubric(template)` runs alongside the hard-coded rubric. CI diffs the two; logs flag drift.
2. **Step B** — `useComposedRubric` flag flips to `true` once parity is confirmed.
3. **Step C** — hard-coded constants in `validation-rubric.ts` deleted; only helper functions (`countWordsInValue`, `findForbiddenSnippets`, `concatStrings`) remain.

ACR-007 starts after VAL-004/005/009 merge to `main`. Until then, the registry + composition pipeline is fully usable for inspection and dashboard surfaces; Validator continues to use the hard-coded rubric.

## Coordination points

- **VAL-### track** — see ACR-007 above. The `EA_OWNED_PREFIXES` ownership classifier in `validator-loop.ts` already routes failures on `architecturalInstructions` to EA, so contract-driven failures will route correctly post-swap.
- **ARCH-### track** — `eaAgentContract` declares `architecturalInstructions` as a stub (`z.array(z.unknown()).default([])`). When ARCH-006 lands the typed field, bump `ea-agent.contract.ts` version to v1.1.0; the composed template signature changes, the Validator's cached rubric invalidates, AKG entity-ref rubric kicks in.
- **TEST-### track** — `testDesignAgentContract` wraps the existing `testCases` field; the schema's `superRefine` already enforces `totalCases == testCases.length` and per-category counts.
- **BUCKET-### track** — taxonomy enums (`LIFECYCLE_VALUES`, `PRIORITY_VALUES`, `EFFORT_VALUES`, etc.) are consumed read-only by the contracts.

## Reference

- Architecture report: `~/Documents/projects/reports/agent-contract-registry-architecture-2026-04-28.md`
- Source of truth for types: `packages/ticket-template/src/section-contract.ts`
- Composition algorithm: `packages/agent-contract-registry/src/compose-template.ts`
- Per-agent contracts: `apps/orchestrator/src/agents/{po,ba,ea,test-design}-agent.contract.ts`
- Bootstrap: `apps/orchestrator/src/agents/contract-bootstrap.ts`
- E2E test: `apps/orchestrator/tests/agents/contract-registry-multi-scope-e2e.test.ts`
