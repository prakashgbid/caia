# @caia/feature-flagging-architect

Architect #12 of CAIA's 17-architect EA fan-out.

Owns the `featureFlags.*` slice of `tickets.architecture`:

- `featureFlags.flagsSchema` — per-flag name, types, per-environment defaults, audience targeting
- `featureFlags.rolloutStrategies` — percentage rollout, user-id rollout, canary, ring deployment
- `featureFlags.killSwitches` — must-be-toggleable-instantly flags
- `featureFlags.experimentationLinkage` — which flags feed which A/B tests (forward-references the A/B Testing Architect)
- `featureFlags.auditRequirements` — who can toggle, audit-log per change

Specifies **what gets toggleable, at what granularity, and what the rollout strategy is**.
Does NOT write component code or backend logic — Frontend & Backend Architects own those.

## Depends on

- `@caia/frontend-architect` (reads `frontend.componentTree`, `frontend.interactionStates`)
- `@caia/backend-architect` (reads `backend.apiEndpoints`)

## Runtime

- Model: Sonnet (default). 1 LLM call per flag-touching ticket.
- Spawned via `@chiefaia/claude-spawner` (subscription-only — never sets `ANTHROPIC_API_KEY`).

## Stack reminder

`shadcn/ui + Tailwind` is locked. This architect emits no UI but its
`experimentationLinkage` forward-references the A/B Testing Architect, which
in turn drives `frontend.componentTree` variant rendering.
