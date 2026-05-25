# `@caia/grand-idea` — Stage 2 Implementation Plan

**Submitted for EA Architect review.** Per CAIA convention, this plan is
written to disk under the package it describes and submitted via
`@caia/ea-architect` `submitPlan` before implementation begins.

**Date:** 2026-05-25
**Stage:** 2 — Grand Idea capture
  (operator pipeline numbering; corresponds to FSM transition
  `onboarding → idea-captured`).
**Spec sources (canonical):**
- `research/state_machine_handoff_spec_2026.md` — FSM states + transition table
- `research/step1_onboarding_spec_2026.md` — preceding onboarding contract
- `research/step3_interviewer_agent_v2_spec_2026.md` — downstream consumer of the captured idea
- `packages/state-machine/src/states.ts` + `src/transitions.ts` — `onboarding → idea-captured` already enumerated
- `packages/onboarding/migrations/0001_caia_meta_init.sql` — per-tenant + meta migration patterns
- `apps/admin/components/Wizard.tsx` — minimal-styling React-form convention to match

## 1. Intent

`@caia/grand-idea` is the seam between **onboarding** (Stage 1, already
shipped via `@caia/onboarding`) and the **Interviewer Agent** (Stage 3,
already shipped via `@caia/interviewer`). It captures **one durable
prompt** — the tenant's grand idea — and (a) persists it to a per-tenant
table, (b) emits the FSM transition `onboarding → idea-captured` via
`@caia/state-machine`.

Up to Stage 1 the FSM sits in `onboarding`; the Interviewer can only be
spawned once a non-empty grand-idea prompt exists. Without this package
that handoff is implicit and unobservable — the tenant types something
into a chat box and the interview starts. Making the capture a real step
gives the operator: an immutable artifact (the verbatim founder prompt),
a clean FSM transition to instrument, and a single insertion point for
later guardrails (length floor, profanity filter, language detection).

## 2. Pipeline position

```
Stage 1   @caia/onboarding              → tenant + secrets
Stage 2   @caia/grand-idea              ← THIS PACKAGE
            FSM: onboarding → idea-captured
            writes: caia_<tenant>.grand_ideas
Stage 3   @caia/interviewer             → BusinessPlanV2 (consumes the prompt)
...
```

The FSM transition `onboarding → idea-captured` is **already enumerated**
in `@caia/state-machine/transitions.ts` (line 17). This package is the
authoritative caller for that transition — nothing else writes
`idea-captured`.

## 3. Reused artifacts (DO NOT re-invent)

| Source | Reuse |
|---|---|
| `@caia/state-machine` | `StateMachine` class + `PgStore` for the transition. The transition already exists; this package is the caller. |
| `@caia/onboarding` (`caia_meta.tenants`) | Tenant lookup (slug, schema_name). The package READS this table to resolve `tenant_slug → schema_name` and asserts `tenants.onboarding_complete = true` before allowing capture. |
| `@caia/interviewer` (downstream) | Reads `grand_ideas.prompt` on Stage 3 spawn. Schema is the contract surface. |
| `apps/admin/components/Wizard.tsx` | Inline-style React convention (no Tailwind, plain CSS-in-JS). The Grand Idea form mirrors its visual language for cohesion. |
| `pg` | Per-spec Postgres driver. Pooled. |
| `zod` | Input validation on the API boundary. |

## 4. Module surface

```
caia/packages/grand-idea/
├── EA-PLAN.md                          # this file
├── README.md
├── package.json
├── tsconfig.json
├── vitest.config.ts
├── eslint.config.cjs
├── migrations/
│   └── 001_grand_ideas.sql             # per-tenant {{SCHEMA}} template
├── src/
│   ├── index.ts                        # public exports
│   ├── types.ts                        # GrandIdeaRow, CaptureInput, CaptureResult, errors
│   ├── persistence.ts                  # writeGrandIdea / readLatestGrandIdea
│   ├── api.ts                          # POST /api/grand-idea handler (Cloudflare Access auth)
│   ├── ui-component.tsx                # React form (textarea + submit)
│   ├── state-machine.ts                # transitionToIdeaCaptured wrapper
│   └── errors.ts                       # GrandIdeaError union
└── tests/
    ├── persistence.test.ts             # CRUD + immutability + revision_number bump
    ├── api.test.ts                     # handler unit tests with mocked persistence
    ├── api.auth.test.ts                # Cloudflare Access JWT verification path
    ├── state-machine.test.ts           # transition fires once; idempotent on re-call
    ├── ui-component.test.tsx           # render + submit + error states
    └── integration.test.ts             # full flow with in-memory store + state-machine
```

**No CLI surface.** This package is consumed by `apps/admin` (web form
route) and by the orchestrator (programmatic). No bin script.

## 5. Per-tenant table — `migrations/001_grand_ideas.sql`

```sql
-- @caia/grand-idea — per-tenant Postgres schema.
CREATE SCHEMA IF NOT EXISTS {{SCHEMA}};

CREATE TABLE IF NOT EXISTS {{SCHEMA}}.grand_ideas (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_slug         TEXT NOT NULL,
  revision_number     INTEGER NOT NULL,
  prompt              TEXT NOT NULL,
  prompt_word_count   INTEGER NOT NULL,
  captured_by         TEXT NOT NULL,            -- operator email from CF Access JWT
  captured_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  metadata            JSONB NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (tenant_slug, revision_number),
  CHECK (prompt_word_count >= 5),               -- floor
  CHECK (prompt_word_count <= 5000)             -- ceiling
);

CREATE INDEX IF NOT EXISTS grand_ideas_tenant_revision_idx
  ON {{SCHEMA}}.grand_ideas (tenant_slug, revision_number DESC);

-- LISTEN/NOTIFY trigger — dashboard SSE wakeup
CREATE OR REPLACE FUNCTION {{SCHEMA}}.notify_grand_idea_captured()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM pg_notify('grand_idea_captured', NEW.tenant_slug);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS grand_idea_captured_notify ON {{SCHEMA}}.grand_ideas;
CREATE TRIGGER grand_idea_captured_notify
  AFTER INSERT ON {{SCHEMA}}.grand_ideas
  FOR EACH ROW
  EXECUTE FUNCTION {{SCHEMA}}.notify_grand_idea_captured();
```

**Why the floor and ceiling.** 5-word floor catches accidental empty
submits and one-word entries that the Interviewer cannot turn into a
plan. 5000-word ceiling protects the LLM token budget downstream and
the Postgres TOAST seam. Both numbers are stored as DB CHECKs (canonical
truth) AND validated at the API layer (fast failure).

**Why immutable rows.** Per the same logic the interviewer applies to
`business_plan_revisions`: the operator might iterate. Each rev is a new
row, never UPDATE. `revision_number` bumped via `SELECT MAX(...) FOR UPDATE`
inside the transaction.

## 6. State-machine integration

The package's `transitionToIdeaCaptured(stateMachine, projectId)` wrapper
calls the existing `@caia/state-machine` API:

```ts
await stateMachine.transition({
  projectId,
  from: 'onboarding',
  to: 'idea-captured',
  reason: 'grand-idea-captured',
});
```

The wrapper:
- Validates the project is in `onboarding` (delegates to `@caia/state-machine`'s
  optimistic-concurrency check; bubbles the error).
- Is idempotent on a repeated call within the same revision: if the FSM
  is already in `idea-captured`, no-op + return the existing snapshot.
- Does NOT itself write the `grand_ideas` row — `persistence.writeGrandIdea`
  does that. The orchestrator calls them in order (write row → transition).
  The two ops are NOT atomic across services (Postgres can't gate the
  FSM's distributed move) but the failure modes are bounded: row written
  + FSM transition failed = operator visible in dashboard; row not
  written + FSM moved = impossible because the transition is the second
  step.

**No new FSM states.** The `onboarding → idea-captured` edge is already
in the transition table at `packages/state-machine/src/transitions.ts:17`.

## 7. API route — POST /api/grand-idea

Handler signature (transport-agnostic — the same `handleCaptureRequest`
works for Next.js routes, Cloudflare Workers, and Node HTTP):

```ts
export interface CaptureRequest {
  tenantSlug: string;
  projectId: string;
  prompt: string;
}
export interface CaptureResponse {
  ok: true;
  grandIdeaId: string;
  revisionNumber: number;
  newState: 'idea-captured';
} | {
  ok: false;
  error: 'validation_failed' | 'tenant_not_onboarded' | 'fsm_transition_invalid' | 'internal_error';
  message: string;
}
```

**Auth.** Cloudflare Access JWT verification on every request. The
handler accepts an injectable `accessVerifier: (req) => Promise<{email}|null>`
so production wires CF Access and tests inject a stub. No request without
a verified email is accepted; the email becomes `captured_by` on the row.

**Validation pipeline.**
1. CF Access verifies the request (handler-level).
2. Zod schema validates body shape + prompt word count (5..5000 inclusive).
3. Persistence reads `caia_meta.tenants` to assert
   `(tenant_slug, onboarding_complete=true)`. 404-equivalent + structured
   error if not.
4. Writes the `grand_ideas` row in a Postgres transaction.
5. Calls `transitionToIdeaCaptured(...)`.
6. Returns the response.

Errors at any step return a structured `{ok:false, error, message}`. The
handler never throws to the caller; all failures are mapped to a
discriminated union for the dashboard to render cleanly.

## 8. UI component — `ui-component.tsx`

Default-export React functional component matching the existing Wizard
inline-style convention (no Tailwind, no shadcn npm dep). Props:

```ts
interface GrandIdeaFormProps {
  tenantSlug: string;
  projectId: string;
  initialPrompt?: string;       // pre-fills on revision re-capture
  onCaptured: (result: CaptureResponse & {ok: true}) => void;
  apiBasePath?: string;          // default '/api'
}
```

Renders:
- A heading: "Tell me about your idea".
- A multi-line textarea (12 rows, full width). Live word count below.
- Disabled-submit guard until word count ≥ 5.
- A primary submit button styled to match the Wizard's "Validate &
  continue" button (same shape, color, padding).
- Inline error display on failure (red banner matching Wizard's `result`
  pattern).
- Inline success display + auto-callback `onCaptured(...)` on success.

**No Tailwind dep.** The user spec calls out "shadcn-aligned" but the
existing Wizard ships plain CSS-in-JS. To avoid introducing a Tailwind
build seam in a package that imports cleanly from `apps/admin`, the form
uses inline styles that visually align with the Wizard. "shadcn-aligned"
is satisfied by visual cohesion, not by importing `@shadcn/ui` runtime.

The component is exported via the `./ui-component` subpath (separate
build target so server consumers don't pull React).

## 9. Test inventory (target floor: 20; expect ~28)

| File | Cases (approx) |
|---|---|
| `persistence.test.ts` | 7 — CRUD, revision-number bump under contention, word-count CHECK, ceiling CHECK, immutability assert (no UPDATE), tenant_slug index hit, NOTIFY trigger fires |
| `api.test.ts` | 5 — happy path, validation_failed (short prompt), validation_failed (long prompt), tenant_not_onboarded, fsm_transition_invalid bubble |
| `api.auth.test.ts` | 3 — verified email path, missing JWT, expired JWT |
| `state-machine.test.ts` | 4 — transition fires, idempotent re-call, invalid `from` state bubbles, FSM error surfaces as structured failure |
| `ui-component.test.tsx` | 4 — initial render, word-count gate, submit happy path (fetch mocked), submit error path |
| `integration.test.ts` | 5 — end-to-end with in-memory FSM + memory persistence: capture → state advance → re-capture (rev 2) → cache behavior on duplicate prompt |

**Coverage target.** ≥ 80% lines/branches/functions via the workspace
vitest config defaults.

## 10. Subscription-only & True-Zero

**No LLM calls.** This package is pure I/O — Postgres write + FSM
transition + handler. There is no `@chiefaia/claude-spawner` import.
Subscription-only by construction.

**Admin-merge.** PR opened to `develop`, admin-merged per the operator's
True-Zero directive. CI checks must pass first
(`pnpm --filter @caia/grand-idea test typecheck lint`).

## 11. Parameterised public API (Option E compliance)

Every CAIA-specific path is a constructor argument with a CAIA default:

```ts
const persistence = new GrandIdeaPersistence({
  pgPool,                                  // injected (required)
  tenantSchema: 'caia_pt',                 // resolved from caia_meta.tenants
  metaSchema: 'caia_meta',                 // default
  clock: () => new Date(),                 // default
});

const sm = new StateMachine(...);          // from @caia/state-machine

const handler = createCaptureHandler({
  persistence,
  stateMachine: sm,
  accessVerifier: cloudflareAccessVerify,  // injectable for tests
});
```

No hard-coded paths. No literal tenant slugs. Tests pass an in-memory
persistence + scripted access verifier.

## 12. Risks acknowledged

1. **`caia_meta.tenants` is owned by `@caia/onboarding`.** This package
   READS that table to resolve `tenant_slug → schema_name`. Coupling is
   one-way and well-scoped (tenants is a cross-tenant control-plane
   table; reading it from any package is canonical). If onboarding ever
   moves the table, this package needs a one-line change.
2. **FSM transition is a separate process.** Per §6, the row-write +
   FSM-transition are NOT atomic. The wrapper documents this; the failure
   modes are bounded (visible in dashboard).
3. **Cloudflare Access JWT** is injected, not implemented. The package
   ships a stub verifier for tests; production wires the real
   `@cloudflare/access-jwt` (or equivalent) at the route boundary in
   `apps/admin`. This package does not pull a CF SDK as a hard dep.
4. **The package is small.** It would be tempting to fold this into
   `@caia/onboarding` as a 13th category. Rejected because (a) it lives
   in a different per-tenant schema, not `caia_meta`; (b) it owns its
   own FSM transition; (c) the Interviewer's spawn contract is "read
   `grand_ideas` from the per-tenant schema", and onboarding has no
   business knowing that. Separation matches the
   one-package-per-FSM-transition convention the rest of the pipeline
   follows.

## 13. Definition of done

- `pnpm --filter @caia/grand-idea typecheck` clean (strict TS)
- `pnpm --filter @caia/grand-idea test` green (≥ 20 tests, ≥ 80% coverage)
- `pnpm --filter @caia/grand-idea lint` clean
- Migration applies cleanly to a fresh per-tenant schema (smoke test)
- In-memory integration test demonstrates `onboarding → idea-captured`
  end-to-end including idempotent re-capture
- PR opened to `develop`; admin-merged after Evidence Gate
  (per operator's "True-Zero — admin-merge" directive in the brief)

---

## EA Review request

Reviewer: please verify that:

(a) Splitting Grand Idea capture out of `@caia/onboarding` is the right
    boundary call — onboarding owns secrets/connectors; grand-idea owns
    the founder's prompt + FSM transition.
(b) Writing to a per-tenant table (`caia_<tenant>.grand_ideas`) rather
    than `caia_meta.grand_ideas` matches the data-residency convention
    in `caia_v2_final_plan_2026.md` §6 (per-tenant business content stays
    in per-tenant schemas; only cross-tenant control-plane data lives
    in `caia_meta`).
(c) The FSM-transition wrapper's non-atomicity (row-write + FSM-move
    are sequential, not transactional across services) is acceptable
    given the bounded failure modes documented in §12.
(d) The injected Cloudflare Access verifier is the right seam — keeps
    this package free of a heavy CF SDK dep while preserving real
    auth in production via the `apps/admin` route wiring.

No new ADRs requested by this plan. No existing ADRs amended.
