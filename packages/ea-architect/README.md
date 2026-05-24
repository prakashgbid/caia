# @caia/ea-architect

**EA Architect Agent** — CAIA's platform-level approval gate. Reviews every research / spec / implementation / architecture-change / process-change plan against the EA Repository (61+ ADRs, principles, lessons-learned, risk register, operator feedback memories) BEFORE the plan reaches the operator.

**Distinct from `@caia/ea-reviewer`** — that audits per-ticket composed architecture from the 17 specialist architects. This audits **platform-level** plans. See ADR-040 for the scope split.

## Why this exists

Per the operator's 2026-05-23 directive (`feedback_ea_agent_gates_research.md`):

> every research / plan / spec goes through the EA Agent FIRST. The two of you iterate; only the EA-approved plan reaches me. The EA Agent auto-files ADRs on approval. Escalation to me is rare — reserved for genuine product / business / pricing pivots.

ADR-015 created this agent. The package operationalises ADR-015.

## Usage

```ts
import { EaArchitectAgent } from '@caia/ea-architect';

const agent = new EaArchitectAgent();

// Caller agent (research-bot, planning-bot, etc.) submits a plan:
const outcome = await agent.submitPlan({
  planMarkdown: '## Proposed change\n\nWe will...',
  planType: 'spec',
  callerAgentId: '@caia/researcher',
  submittedBy: 'orchestrator',
  affectedComponents: ['@caia/atlas-mapper']
});

if (outcome.status === 'approved') {
  // proceed; new ADRs were auto-filed; INDEX.md updated
} else if (outcome.status === 'approved-with-modifications') {
  // revise per outcome.requested_modifications; resubmit with same submissionId
} else if (outcome.status === 'rejected') {
  // outcome.reasoning explains why; cited_adrs / cited_principles cite the rules
} else if (outcome.status === 'needs-clarification') {
  // clarify and resubmit; iteration counter bumps
}

if (outcome.escalation_to_operator !== undefined) {
  // operator INBOX got an entry under "## EA AGENT ESCALATIONS"
}
```

## Iteration loop

```
caller drafts plan
  ↓
submitPlan(...) → ReviewOutcome
  ├─ "approved"                       → terminal: ea-review-approved
  ├─ "approved-with-modifications"
  │     iteration 1-2  → ea-review-revisions-requested → caller revises → resubmit
  │     iteration 3+   → ea-review-conditional-approval (terminal, lock to prevent loops)
  ├─ "needs-clarification"            → ea-review-revisions-requested → caller revises → resubmit
  ├─ "rejected"                       → terminal: ea-review-rejected
  └─ if escalation flagged            → terminal: ea-review-escalated-to-operator
                                          (writes to ~/Documents/projects/agent-memory/INBOX.md
                                           under "## EA AGENT ESCALATIONS")
```

Resubmissions use the **same** `submissionId`. The iteration counter increments. Track via `agent.getReviewHistory(submissionId)`.

## What triggers operator escalation

Routine technical approval is **never** escalated. Escalation fires only for:

- **Product pivots** — material change in what CAIA is or who it serves.
- **Billing-model changes** — pricing / subscription / credits-model shifts.
- **Fundamental architecture reversals** — reversing an already-locked load-bearing decision (similar in scope to the 2026-05-23 MUI↔shadcn flip in ADR-060/ADR-061).
- **Security posture changes** — auth model, secrets architecture, multi-tenant isolation contract changes.
- **Principle amendments** — changing P1–P12 or proposing deprecation of one.

The escalation is recorded under a dedicated `## EA AGENT ESCALATIONS` section in the operator's INBOX. The agent does not block on escalation — it surfaces, finalises the verdict as `ea-review-escalated-to-operator`, and the operator triages on their own cadence.

## Auto-filing ADRs

On `approved` or `approved-with-modifications`-as-final, the agent:

1. Computes the next ADR number by scanning `caia-ea/decisions/` (max id + 1).
2. Writes the new ADR file at `caia-ea/decisions/ADR-NNN-<slug>.md` using the Nygard + CAIA-extensions template.
3. Patches each superseded ADR's `Superseded-by:` header to point at the new ADR.
4. Updates `caia-ea/decisions/INDEX.md` (created if missing) with one row per newly-filed ADR.

**Hard rule** (per operator feedback): the agent never approves without updating documentation.

## Model selection

- **Sonnet (default)** — every plan type by default.
- **Opus** — for high-stakes architecture reversals: `planType === 'architecture-change'`, `affectedComponents.length >= 5`, plan markdown > 5,000 words, or iteration >= 3.

Both routes go through `@chiefaia/claude-spawner` (subscription-only per P1 + P14, no API key).

## Hallucination guard

After every LLM call, citations are filtered: cited ADRs / principles / lessons that don't exist on disk are dropped. The reasoning string is preserved, but downstream callers only see verifiable citations.

## State-machine integration

The agent emits dot-namespaced events (per the `@chiefaia/events-taxonomy-internal` convention) on every transition:

- `ea-architect.review.pending` — initial submission or resubmission.
- `ea-architect.review.revisions-requested`
- `ea-architect.review.approved`
- `ea-architect.review.conditional-approval`
- `ea-architect.review.rejected`
- `ea-architect.review.escalated-to-operator`

Subscribe with `agent.on(eventType, handler)`. The default in-process bus is sufficient for single-process use. For multi-process / dashboard fanout, swap in a custom `EaEventBus` that bridges to the existing `ConductorEventBus` (Postgres + WebSocket per ADR-011).

The per-submission FSM lives in this package (`src/state.ts`). It is **not** part of the canonical `@caia/state-machine` project FSM — that one is per-project, not per-plan-submission. If the canonical FSM later gains plan-submission as a first-class entity, the in-package FSM can be deprecated.

## Architecture

```
submitPlan(input)
  ↓
loadRepository(caia-ea/, agent-memory/)
  ├─ ADRs (61+)         — scan caia-ea/decisions/ADR-*.md
  ├─ Principles (12)    — parse caia-ea/principles/00-architecture-principles.md
  ├─ Lessons            — caia-ea/lessons-learned/*.md
  ├─ Risks              — caia-ea/risk-register/00-current-risks.md
  └─ Feedback (7)       — agent-memory/feedback_*.md + project_caia_shadcn_*.md
  ↓
selectRelevantContext(query, affectedComponents)
  ├─ topic-relevant ADRs (keyword overlap)
  ├─ ALL principles (every plan checked against every principle)
  ├─ topic-relevant lessons + risks
  └─ ALL feedback memories
  ↓
critic.review(input)
  ├─ buildCriticPrompt — system + EA context + plan
  └─ spawnClaude (subscription-only) → JSON envelope → CriticOutput
  ↓
applyHallucinationGuard — drop unverifiable citations
  ↓
detectStrategicEscalation — keyword-trigger fallback
  ↓
chooseTargetState — pick FSM terminal
  ↓
if approved → writeNewAdr() + applySupersessions() + updateDecisionsIndex()
if escalating → appendEscalationToInbox()
  ↓
emit EaReviewEvent → bus
  ↓
return ReviewOutcome
```

## Forward-looking integration

### Conductor Agent (when it lands)

Conductor will subscribe to `ea-architect.review.*` events for governance visibility. Wire-up will be event-based — the EA Agent does not import Conductor; Conductor imports the event types from this package's public surface.

Hookup point: `agent.on('*', (event) => conductor.recordReview(event))` once Conductor exposes that API.

### Dashboard

Dashboard will read `ReviewHistory` via `getReviewHistory(submissionId)` and stream events from the same bus. Render under a `/governance/ea-reviews` route. Per-submission timeline view + per-caller-agent throughput stats.

### Comm-Protocol Agent (when it lands)

Once Inter-Agent Communication Protocol research lands and a broker is chosen, the EA Agent's `submitPlan` becomes a broker-published request type. Until then, callers import this package directly and call `submitPlan` in-process. This is the bootstrap pattern.

### HTTP API

A `POST /api/ea-architect/review` endpoint exists conceptually — once the CAIA HTTP server (search the repo: an orchestrator's `apps/admin` is the closest surface today; the canonical endpoint lands when the orchestrator-middleware grows EA routes) is wired, this package's `submitPlan` is the handler. The endpoint accepts `PlanSubmission`, returns `ReviewOutcome`. For long-running reviews (>30s), the endpoint can queue and return a 202 with the submission id; clients poll `getReviewHistory`. Not implemented in this PR — the broker-based path is preferred.

## Testing

```sh
pnpm --filter @caia/ea-architect test
pnpm --filter @caia/ea-architect typecheck
pnpm --filter @caia/ea-architect lint
pnpm --filter @caia/ea-architect build
```

Tests use `InMemoryFsAdapter` to avoid touching the real EA Repository. Golden fixtures in `tests/fixtures/` exercise the three terminal verdicts (approved + ADR filed; modifications-requested; rejected with cited principles).

## Constraints

- **Subscription-only LLM** per P1 + P14 + `feedback-caia-build-uses-pro-subscription-only` — Claude reached via `@chiefaia/claude-spawner` (no API key).
- **No timelines** per P3 + `feedback-no-timelines` — outcomes never quote ETAs.
- **No idle / no waiting** per P4 — submitPlan resolves; the caller acts on the outcome immediately.
- **Auto-merge PRs** per `feedback-auto-merge-prs` — applies to this package's CI flow.
- **shadcn/ui locked** per `project-caia-shadcn-react-first-locked` — no UI in this backend package; the principle is loaded into context for plans that DO touch UI.

## License

MIT (private workspace package).
