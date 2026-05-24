/**
 * Tiny in-memory EA Repository for tests.
 *
 * Mirrors the on-disk shape (decisions/ADR-NNN-*.md, principles/00-*.md,
 * lessons-learned/*.md, risk-register/00-*.md) but stays small enough
 * that test assertions can be exhaustive.
 */

export const REPO_ROOT = '/test/caia-ea';
export const AGENT_MEMORY_ROOT = '/test/agent-memory';
export const INBOX_PATH = `${AGENT_MEMORY_ROOT}/INBOX.md`;

export function sampleRepoFiles(): Record<string, string> {
  return {
    // README so the loader's exists() checks pass
    [`${REPO_ROOT}/README.md`]: '# CAIA EA Repository\n',

    // Principles
    [`${REPO_ROOT}/principles/00-architecture-principles.md`]: `# CAIA Architecture Principles

## P1 — Subscription-only LLM during build phase

**Statement.** All Claude calls use the subscription, never the API.

**Rationale.** Flat fee subscription.

**Implications.** Use @chiefaia/claude-spawner.

## P2 — Zero-dollar budget at MVP

**Statement.** No new paid SaaS.

**Rationale.** Cost discipline.

**Implications.** Free or self-hosted only.

## P3 — No timelines, ever

**Statement.** No calendar estimates.

**Rationale.** Operator's directive.

**Implications.** Critical path only.

## P4 — No idle, no waiting

**Statement.** Dispatch next step immediately.

**Rationale.** Avoid bottlenecks.

**Implications.** Self-perpetuating campaigns.

## P9 — TOGAF-lightweight, not enterprise-heavy

**Statement.** No ceremonial gates. EA Agent is the compliance check.

**Rationale.** Solo founder context.

**Implications.** Skip ADM ceremony. EA Agent reviews.
`,

    // ADRs
    [`${REPO_ROOT}/decisions/ADR-001-pro-subscription-only-during-build.md`]: `# ADR-001 — Pro subscription only during build

- **Status:** Accepted
- **Date:** 2026-04-01
- **Affected-components:** all packages
- **Reversibility:** One-way
- **Operator-sign-off-required:** yes

## Context

Subscription vs API debate.

## Decision

Use subscription via claude binary.

## Consequences

- Positive: flat fee.
- Negative: rate limits.
`,
    [`${REPO_ROOT}/decisions/ADR-009-bypass-cd-direct-build-for-caia-dashboard.md`]: `# ADR-009 — Bypass CD direct build for dashboard

- **Status:** Accepted
- **Date:** 2026-05-01
- **Affected-components:** dashboard, atlas
- **Reversibility:** Reversible

## Context

Cost of CD subscription too high.

## Decision

Direct build skipping CD.

## Consequences

- Positive: lower cost.
`,
    [`${REPO_ROOT}/decisions/ADR-029-57-event-types-across-15-namespaces.md`]: `# ADR-029 — 57 event types across 15 namespaces

- **Status:** Accepted
- **Date:** 2026-04-28
- **Affected-components:** events-taxonomy-internal, all event emitters
- **Reversibility:** Reversible per event-type

## Context

Without a registered taxonomy, ad-hoc event names proliferate.

## Decision

The event taxonomy is centralised at registry.yaml. Invalidate on repository write events.

## Consequences

- Single source of truth.
`,
    [`${REPO_ROOT}/decisions/ADR-015-ea-architect-agent-for-plan-approval.md`]: `# ADR-015 — Create @caia/ea-architect for plan approval

- **Status:** Accepted
- **Date:** 2026-05-23
- **Affected-components:** @caia/ea-architect, @caia/state-machine
- **Reversibility:** Reversible

## Context

Operator removed from per-plan approval.

## Decision

Build the EA Architect Agent.

## Consequences

- Positive: operator off the critical path.
`,
    [`${REPO_ROOT}/decisions/ADR-040-ea-reviewer-vs-ea-architect-scope-distinction.md`]: `# ADR-040 — EA Reviewer vs EA Architect scope

- **Status:** Accepted
- **Date:** 2026-05-23
- **Affected-components:** @caia/ea-reviewer, @caia/ea-architect

## Context

Two agents with EA in the name; need scope split.

## Decision

Reviewer = per-ticket. Architect = platform-level.

## Consequences

- Clear demarcation.
`,
    [`${REPO_ROOT}/decisions/ADR-060-mui-react-first-stack.md`]: `# ADR-060 — MUI React-first stack

- **Status:** Superseded by ADR-061
- **Date:** 2026-05-23
- **Supersedes:** none
- **Superseded-by:** ADR-061
- **Affected-components:** all UI packages
- **Reversibility:** Reversible

## Context

Component library choice.

## Decision

Use MUI.

## Consequences

- Positive: maturity.
`,
    [`${REPO_ROOT}/decisions/ADR-061-stay-with-shadcn-tailwind-canonical-stack.md`]: `# ADR-061 — shadcn/Tailwind canonical stack

- **Status:** Accepted
- **Date:** 2026-05-23
- **Supersedes:** ADR-060
- **Superseded-by:** none
- **Affected-components:** all UI packages
- **Reversibility:** High cost to reverse

## Context

MUI was locked then unlocked same day.

## Decision

shadcn + Tailwind canonical.

## Consequences

- Better AI codegen affinity.
`,

    // Lessons learned
    [`${REPO_ROOT}/lessons-learned/01-pixel-perfect-calibration.md`]: `# Pixel-perfect calibration

Date: 2026-05-10
Tags: design, calibration

What happened: 62% pixel-perfect on first pass.

What we tried: 4 rounds of calibration.

Lesson: calibrate per component, not platform-wide.
`,
    [`${REPO_ROOT}/lessons-learned/04-local-ai-stack-teardown.md`]: `# Local AI stack teardown

Date: 2026-05-20
Tags: local-ai, teardown, ollama

What happened: tore down local-AI router stack.

Lesson: prefer subscription Claude until concrete evidence of cap pressure.
`,

    // Risk register
    [`${REPO_ROOT}/risk-register/00-current-risks.md`]: `# Risk Register

## Security

- Secret leakage
- Prompt injection

## Vendor lock-in

- Anthropic Claude dependency
- Cloudflare API shape

## Operational

- Single server SPOF on stolution
`,

    // Templates
    [`${REPO_ROOT}/templates/adr-template.md`]: `# ADR-NNN — Title

- **Status:** Proposed | Accepted
- **Date:** YYYY-MM-DD
- **Decision-makers:** Operator | EA Architect Agent | Both
- **Supersedes:** ADR-XXX (or none)
- **Superseded-by:** none

## Context

## Decision

## Consequences
`,

    // Agent memory feedback files
    [`${AGENT_MEMORY_ROOT}/feedback_no_timelines.md`]: `---
name: feedback-no-timelines
description: Operator does not want timelines / day estimates discussed.
metadata:
  type: feedback
---

Never quote calendar days, weeks, hours-to-MVP, or ETA estimates.
`,
    [`${AGENT_MEMORY_ROOT}/feedback_no_idle_no_waiting.md`]: `---
name: feedback-no-idle-no-waiting
description: Never leave outputs idle waiting on the operator.
metadata:
  type: feedback
---

After every task completion, fire the next dispatch in the same message.
`,
    [`${AGENT_MEMORY_ROOT}/feedback_auto_merge_prs.md`]: `---
name: feedback-auto-merge-prs
description: Operator does NOT want to be asked to merge PRs. Admin-merge them autonomously.
metadata:
  type: feedback
---

Auto-merge PRs via gh pr merge admin.
`,
    [`${AGENT_MEMORY_ROOT}/feedback_action_research_outputs.md`]: `---
name: feedback-action-research-outputs
description: Research outputs must have a clear next action.
metadata:
  type: feedback
---

On every research/spec task completion, surface or dispatch.
`,
    [`${AGENT_MEMORY_ROOT}/feedback_ea_agent_gates_research.md`]: `---
name: feedback-ea-agent-gates-research
description: EA Agent is the gate for all research/plans before operator review.
metadata:
  type: feedback
---

Every research/plan goes through the EA Agent first.
`,
    [`${AGENT_MEMORY_ROOT}/feedback_caia_build_uses_pro_subscription_only.md`]: `---
name: feedback-caia-build-uses-pro-subscription-only
description: Subscription only during CAIA build phase.
metadata:
  type: feedback
---

Never API keys; only subscription via claude binary.
`,
    [`${AGENT_MEMORY_ROOT}/project_caia_shadcn_react_first_locked.md`]: `---
name: project-caia-shadcn-react-first-locked
description: shadcn/ui + Tailwind locked as canonical component library.
metadata:
  type: project
---

shadcn over MUI for AI-assisted codegen reasons.
`
  };
}
