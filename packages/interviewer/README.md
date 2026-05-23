# @caia/interviewer

The CAIA Interviewer Agent — conversational state machine, question generator,
business-plan accumulator, and Series-Seed VC critic. Converges a founder's
grand-idea into an investor-grade `BusinessPlanV2` in roughly 30-50 turns.

Implements the spec at
[`research/step3_interviewer_agent_v2_spec_2026.md`](../../../research/step3_interviewer_agent_v2_spec_2026.md)
§1 (state machine) and §5 (mechanics). Consumes the playbook authored under
`skills/playbook/` (16 pillars, 364 questions) — see the sibling commit
`feat(interviewer): startup-consultant playbook skill`.

## State machine

```
INIT → PLANNING → ASKING → AWAITING_USER → INGESTING → EVALUATING
      ↘ if score < 82                                       ↓
        PLANNING ←─────────────────────────────────────  if ≥ 82
                                                          ↓
                                                    SELF_CRITIQUE
                                                          ↓
                                                    (clean) → COMPLETE → HANDOFF
                                                    (gaps)  → PLANNING

PAUSED        ← AWAITING_USER timeout / operator pause
FORCE_CLOSED  ← operator override (any non-terminal state)
```

`HANDOFF` and `FORCE_CLOSED` are terminal.

## Public API

```ts
import { Interviewer, loadPlaybook, InterviewerPersistence } from '@caia/interviewer';

const playbook = await loadPlaybook();
const interviewer = new Interviewer({
  playbook,
  llm:          new DefaultLlmCaller(),          // subscription-only (no API key)
  persistence:  new InterviewerPersistence({ pool }),
  tenantSlug:   'pt',
  operatorEmail:'prakash@caia.dev',
});

// Start
const start = await interviewer.start({ grandIdeaPrompt });

// Loop
let result = await interviewer.submitUserReply(replyText);
while (result.state === 'AWAITING_USER') {
  result = await interviewer.submitUserReply(nextReplyText);
}

// Or pause / resume / force-close
await interviewer.pause();
await interviewer.resume();
await interviewer.forceClose(operatorEmail, 'operator_force');
```

## Subscription-only contract

All LLM dispatch flows through `@chiefaia/claude-spawner`, which scrubs
`ANTHROPIC_API_KEY` and forces OAuth/keychain. There is no pay-per-token
fallback. See [`feedback_no_api_key_billing.md`](../../../research/feedback_no_api_key_billing.md).

## Persistence

Per spec §6, each interview lives in a per-tenant schema `caia_<short>`
(e.g., `caia_pt`). Three append-only tables track the conversation:

- `interviews`              — header + state + plan JSONB + rubric
- `interview_turns`         — immutable audit log (agent / user / system)
- `business_plan_revisions` — snapshots with JSON Patch diffs
- `interview_deferred`      — denormalized deferred-question queue

DDL lives at `migrations/0001_interviewer.sql`. The Postgres trigger
`notify_interview_revision` emits `NOTIFY interview_revision, '<interview_id>'`
on every new revision so the dashboard SSE endpoint can push updates in real time.

For tests / dry-runs without a real database, use `MemoryInterviewerPersistence`.

## Critic

A separate Claude session (the "Series Seed VC" subagent) reviews the plan once
it crosses the rubric threshold (default ≥ 82). Gate: `recommendation === 'meeting'`
AND no `blocker`-severity items. Otherwise the state machine rolls back to
PLANNING with the blockers as picker hints. Critic runs at most twice per
interview.

## Layout

```
src/
  index.ts                 # public surface
  types.ts                 # all enums, interfaces
  errors.ts                # InterviewerError + codes
  business-plan.ts         # zod schema + section helpers
  playbook-loader.ts       # parses skills/playbook/question-templates.json
  state-machine.ts         # FSM with adjacency-table guards
  question-generator.ts    # deterministic picker + Mom-Test linter
  accumulator.ts           # per-pillar coverage + rubric assembly
  critic.ts                # Series Seed VC subagent
  persistence.ts           # Postgres + in-memory adapter
  llm.ts                   # @chiefaia/claude-spawner wrapper + test seam
  prompts.ts               # all LLM prompt templates
  interviewer.ts           # orchestrator (public entry)
  test-support.ts          # scripted personas + PersonaLlm for integration tests

migrations/
  0001_interviewer.sql

skills/playbook/           # authored by sibling task
  SKILL.md
  question-templates.json
  business-plan-schema.json
  examples.md

tests/
  *.test.ts                # 92 unit tests
  integration/
    scripted-founder.integration.test.ts   # 4 end-to-end tests
```

## Tests

```bash
pnpm test              # unit tests (92 tests, ~250ms)
pnpm test:integration  # scripted-founder convergence (4 tests, ~250ms)
```

The integration suite drives an end-to-end interview against two deterministic
founder personas — `ALICE_CONSENTLANE` (convergent, B2B SaaS with sourced
answers) and `BOB_GREENZAP` (vague consumer thesis that legitimately fails to
converge). Both run through the full state-machine path with `PersonaLlm` (a
deterministic `LlmCaller` that emits structurally-valid responses for each
phase) and `MemoryInterviewerPersistence`.
