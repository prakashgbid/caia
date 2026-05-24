/**
 * Three real-shaped plans used by golden tests:
 *  1. obviously-good plan → approved + ADR filed
 *  2. partial plan → approved-with-modifications
 *  3. obviously-bad plan → rejected with reasoning citing principles
 */

export const GOOD_PLAN_MD = `# Spec — Standardize EA Agent's event namespace

## Context

The EA Architect Agent emits events. We need a canonical namespace
following the existing ADR-029 convention (57 event types across 15
namespaces). Per ADR-029, new event types add via a registry update +
type-narrowing union + regression test.

## Decision

Use \`ea-architect.review.<state>\` as the dotted namespace for all
six EA review state transitions. Register the namespace in
\`packages/events-taxonomy-internal/registry.yaml\` alongside existing
namespaces (pipeline, story, …).

## Consequences

- Positive: dashboards filter consistently; downstream consumers can
  glob \`ea-architect.*\`.
- Negative: a small ceremony when adding a new transition type.

## Affected components

\`@caia/ea-architect\`, \`@chiefaia/events-taxonomy-internal\`.

## Subscription path

All Claude calls during build phase use the operator's Pro subscription
via \`@chiefaia/claude-spawner\`. No API keys. (Per P1 + ADR-001.)
`;

export const MODIFICATIONS_PLAN_MD = `# Spec — Add caching layer to repository loader

## Context

The repository loader reads disk on every review. For low-traffic
operation this is fine, but if review throughput grows we may want a
cache.

## Decision

Add an in-memory cache keyed by repository root. TTL 60 seconds.

## Affected components

\`@caia/ea-architect\`.
`;

export const BAD_PLAN_MD = `# Spec — Wire the agent to Anthropic API with our key

## Context

We want the agent to be faster. Subscription has limits.

## Decision

Set ANTHROPIC_API_KEY in the process env and route all EA agent calls
through the Anthropic API directly with our pay-per-token key. Skip
the @chiefaia/claude-spawner subscription path.

We will also remove the no-timelines rule because shipping in 4 days
matters more than the operator's directive.

## Consequences

- Positive: maybe a bit faster.
- Negative: we burn money and break P1, P3.

## Affected components

\`@caia/ea-architect\`.
`;
