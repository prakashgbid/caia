# `apps/dashboard` — Wizard step pages (1, 2, 5, 6, 7)

**Author:** autonomous-build (operator-dispatched 2026-05-25)
**Status:** Implementation
**ADR refs:** ADR-024 (IA Step 3.5), ADR-061 (canonical `@caia/ui`), ADR-065 (reuse-first as enforced discipline)
**Branch:** `feature/wizard-steps-1-2-5-7-2026-05-25`
**True-Zero admin-merge:** RATIFIED via PR #587 carve-out (`.caia/build-phase-active` present).

## 1. Why this exists

PR #601 landed the wizard SHELL (layout + `[step]/page.tsx` slug router + `useWizardState` hook + middleware + state API route). The shell currently renders a `Coming soon` Card stub for every step. This PR fills in the customer-facing step pages for **Step 1 (onboarding)**, **Step 2 (grand-idea)**, **Step 5 (proposal)**, **Step 6 (design)**, and **Step 7 (atlas)**.

Steps 3 (interview) and 4 (architecture) are explicitly **out of scope** — they ship on sibling branches (PR #596 + the IA agent PR #594 follow-up).

## 2. Scope of this PR

### 2.1 In scope

1. **Step 1 onboarding page** — `app/wizard/onboarding/page.tsx`. Server-rendered list of the 19 `@caia/onboarding` categories, each rendered as a `@caia/ui` Card row. A `'use client'` `OnboardingStepForm` component drives the per-category submit through `/api/wizard/[projectId]/state` PATCH dispatching `onboarding → idea-captured` once mandatory categories are passed/deferred.

2. **Step 2 grand-idea page** — `app/wizard/grand-idea/page.tsx`. Mounts the **existing** `GrandIdeaForm` from `@caia/grand-idea/ui-component` inside a `@caia/ui` Card container only (no nested shadcn — `GrandIdeaForm` carries its own inline-style design per its header). On success → calls the wizard state PATCH route to ensure `idea-captured` is the project state. Uses `advanceToIdeaCaptured` semantics (idempotent on already-captured projects).

3. **Step 5 proposal page + API route**:
   - `app/wizard/proposal/page.tsx` (`'use client'`) — "Generate proposal" CTA → `POST /api/wizard/proposal/generate`. Renders the three Markdown renderers (executive summary, full proposal, one-pager) as `@caia/ui` Accordion items + the design-app prompt envelope. "Approve & continue" PATCHes to `proposal-generated` (the canonical FSM target; `proposal-in-progress` is not a literal FSM state — the route handler handles the actual edge).
   - `app/api/wizard/proposal/generate/route.ts` — server-side handler that imports `runStep5` from `@caia/business-proposal-generator`. Wires `MemoryBlobStorage` + an in-memory `IProposalPersistence` for the V1 wizard path (BYOC blob storage is a Wave 2 swap). Uses a `ScriptedLlmCaller` for deterministic dev/test responses; production swap to `DefaultLlmCaller` is gated by an env flag.

4. **Step 6 design page** — `app/wizard/design/page.tsx`. Reads the design-app prompt text from the prior step via a state-API helper (or via search params from the proposal step). Renders it inside a `@caia/ui` Card with a "Copy" button (clipboard write). "I've uploaded my design" → opens a `@caia/ui` Dialog that surfaces a stub `@caia/design-ingest` upload form (the full adapter dispatch is wired in PR #596 / design-ingest follow-ups). On confirmed upload → PATCH to `design-uploaded` (which is the canonical FSM target; `external-design-uploaded` in the brief maps to the canonical `design-uploaded`).

5. **Step 7 atlas page** — `app/wizard/atlas/[projectId]/page.tsx`. Mounts `AtlasShell` + `DesignPane` + `TicketPane` + `PromptDock` from `@caia/atlas-ui`. Uses the `createMockClient` fixture for the V1 wizard path so the page renders without a live atlas backend. Per-element prompt submission posts to a tiny adapter that calls `createAtlasPromptApiHandler` from `@caia/atlas-prompt-router` (the full router wiring lives in the design-ingest + atlas follow-up PRs).

6. **Tests** — ≥10 vitest cases per page (5 pages × 10+ = 50+ unit tests) covering: render, FSM PATCH dispatch, error surfaces, copy-to-clipboard, dialog open/close, accordion expansion, proposal generation success + cache-hit, atlas-shell mount. Plus a single Playwright E2E (`tests/wizard-shell/wizard-steps-e2e.spec.ts`) that walks all 5 step paths under the dev mock-auth cookie.

### 2.2 Out of scope (sibling PRs own these)

- Step 3 (interview) UI — PR #596 lineage.
- Step 4 (architecture) UI — IA agent PR #594 follow-up.
- Live blob storage wiring (BYOC R2/S3/GCS).
- Live Postgres `business_proposals` / `designapp_prompts` / `proposal_revisions` tables — V1 wizard handler is in-memory; persistence swaps in Wave 2.
- Live Infisical secret-ref wiring for the onboarding form's credential descriptors — the form collects values; the engine PUTs are stubbed out for the V1 wizard path.

## 3. Reuse-first compliance

Every UI primitive comes from `@caia/ui` (Card, CardHeader, CardTitle, CardDescription, CardContent, Button, Input, Accordion + items, Dialog + parts, Tabs, Form, Progress, Badge, ScrollArea, Sheet). Raw shadcn/Radix/Tailwind imports are forbidden by Semgrep `caia-no-raw-shadcn-import-outside-ui-package`.

Domain logic comes from the named `@caia/*` packages:
- `@caia/onboarding` (engine + 19 categories) for step 1
- `@caia/grand-idea` (`GrandIdeaForm` + `advanceToIdeaCaptured`) for step 2
- `@caia/business-proposal-generator` (`runStep5` + `MemoryBlobStorage` + `MemoryProposalPersistence` + `ScriptedLlmCaller`) for step 5
- `@caia/design-ingest` (types + `Ingestor` deps) for step 6
- `@caia/atlas-ui` (`AtlasShell` + `DesignPane` + `TicketPane` + `PromptDock` + `createMockClient`) for step 7
- `@caia/atlas-prompt-router` (`createAtlasPromptApiHandler`) for step 7 prompts
- `@caia/state-machine` (`canTransition`, `ProjectState`) for FSM gating

See §4 for the full reuseSearchResults table mirrored in `EA-REVIEW-OUTCOME.json`.

## 4. ReuseSearchResults summary

See `EA-REVIEW-OUTCOME.json` for the structured `reuseSearchResults` field. Every `@caia/*` and `@chiefaia/*` candidate that could conceivably touch this slice was considered, with a `selected | rejected` decision and a reason.

## 5. Test strategy

- **Unit (vitest, jsdom)** — per-page tests at `tests/wizard-shell/wizard-steps/<step>.test.tsx`. Mocks the network with `vi.spyOn(globalThis, 'fetch')`. Validates the rendered DOM via `@testing-library/react`.
- **E2E (Playwright)** — single `wizard-steps-e2e.spec.ts` that walks `/wizard/onboarding`, `/wizard/grand-idea`, `/wizard/proposal`, `/wizard/design`, `/wizard/atlas/p-stub` under the `MOCK_CF_AUTH` cookie shortcut from PR #601.

## 6. Definition of Done

- All 5 step pages render and mount their backing packages.
- 50+ vitest cases pass.
- 1 Playwright E2E walks all 5 paths under the dev mock cookie.
- PR merged into `develop` via True-Zero admin-merge squash.
- `EA-REVIEW-OUTCOME.json` records the `reuseSearchResults` table in this file.
