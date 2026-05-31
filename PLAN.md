# `apps/wizard` — Critic-loop UI for IA + Interview steps (WIZARD-B6)

**Author:** cowork-mode-claude-phase-b-ui (operator-dispatched 2026-05-31)
**Status:** Implementation complete
**Branch:** `feature/wizard-b6-critic-loop-ui-2026-05-31`
**True-Zero admin-merge:** Subscription-only, build-phase carve-out applies.

## 1. Why this exists

Phase B Task B6 of the CAIA wizard pipeline: when the IA critic returns
`approved-with-modifications` (Step 4) OR when the Interviewer's critic
flags coverage as `coverage-insufficient` (Step 3), the user needs an
inline surface to review the modifications and rerun the step with the
ones they want to apply. B6 ships that surface.

## 2. Shape

```
apps/wizard/components/wizard/CriticFeedbackPanel.tsx          # shared panel
apps/wizard/components/wizard/ArchitectureCriticBridge.tsx     # IA step bridge
apps/wizard/components/wizard/InterviewCriticBridge.tsx        # Interview step bridge
apps/wizard/app/wizard/architecture/page.tsx                   # mounts ArchitectureCriticBridge
apps/wizard/app/wizard/interview/page.tsx                      # mounts InterviewCriticBridge
apps/wizard/tests/wizard-shell/wizard-steps/critic-feedback-panel.test.tsx  # 16 vitest cases
```

`<CriticFeedbackPanel>` renders:
- a header with the kind-specific title + step badge.
- a `@caia/ui` Accordion of modification items. Each item carries an
  inline severity Badge (p0..p3) + category Badge + a checkbox.
- "Apply & rerun" primary button that POSTs `{ ...rerunBody,
  applyModifications: [...selectedIds] }` to `feedback.rerunEndpoint`.
- "Dismiss" secondary button that fires `onDismiss` so the parent can
  hide the panel without rerunning.
- a loading state while the rerun POST is in flight (button label
  changes to "Rerunning…" and both buttons are disabled).
- an inline error message when the POST returns non-2xx.

Two bridges (`ArchitectureCriticBridge` / `InterviewCriticBridge`)
wrap the panel for each step and own the local dismissal state. They
exist because the panel is `'use client'` (it owns selection + fetch
state) and the wizard pages are server components; the bridges are
the client boundary that owns the panel's lifecycle props.

## 3. Reuse-first

| Need | Existing package consumed |
|---|---|
| Accordion + AccordionItem + AccordionTrigger + AccordionContent | `@caia/ui` |
| Card + CardHeader + CardTitle + CardDescription + CardContent | `@caia/ui` |
| Badge (p0..p3 severity + category) | `@caia/ui` |
| Button (primary + ghost variants) | `@caia/ui` |

No raw shadcn/Radix imports outside `packages/ui/**`. No third-party
collapsible / accordion / dialog libs. `fetchImpl` is the test seam;
production uses the global `fetch` (Next.js polyfill on the client).

## 4. Wiring

The architecture page (`apps/wizard/app/wizard/architecture/page.tsx`)
mounts the `<ArchitectureCriticBridge>` underneath its placeholder
copy. The bridge reads a `criticKind` searchParam:
`?criticKind=approved-with-modifications` mounts the panel against a
stub feedback envelope so the operator can preview the UX without a
live runIA. Wave 2 swaps the searchParam wiring for a Pg-backed read
of the most recent runIA verdict.

The interview page (`apps/wizard/app/wizard/interview/page.tsx`)
mounts the `<InterviewCriticBridge>` beneath the chat surface, behind
the same `criticKind` searchParam. The interview rerun endpoint is the
existing `/api/wizard/interview/complete` route (which already returns
412 + coverage diagnostics when the critic flags coverage-insufficient).

## 5. Tests

16 vitest cases in `tests/wizard-shell/wizard-steps/critic-feedback-panel.test.tsx`:

- Rendering (5): approved-with-modifications title for IA, coverage-insufficient
  title for Interview, accordion items per modification, severity badges
  rendered, category badges rendered.
- Selection + dismissal (4): all modifications selected by default,
  checkbox toggles off when clicked, onDismiss fires on Dismiss click,
  Dismiss does not trigger a fetch.
- Apply-and-rerun (4): POSTs the selected ids to the rerunEndpoint,
  omits unchecked modifications from the body, calls onRerunSuccess
  with the parsed body, surfaces server error messages on non-2xx.
- Loading state (2): "Rerunning…" copy appears mid-flight, both buttons
  disabled mid-flight.
- Empty modifications (1): placeholder copy + no accordion.

Brief requested ≥15. Whole wizard suite: 326/326 pass.

Pre-existing develop failures (TS2352 in `tests/wizard-shell/edge-bypass.test.ts`,
lighthouse warn-only) unchanged. The Build·Test·Lint·Typecheck wedge
that B1 introduced was FIXED by B2 (client-safe tracer + `/server`
subpath export); B6 inherits that fix.

## 6. Subscription-only

The panel never invokes Claude directly. The Apply-and-rerun button
POSTs to the existing wizard endpoints which already use the
canonical wrapper chain (B7 retry + B3 OTel span + B4 search-path).
No new LLM call surface is added by B6.

## 7. True-Zero readiness

- Panel tests `pnpm exec vitest run` → 16/16 pass.
- Whole wizard suite `pnpm exec vitest run` → 326/326 pass.
- Local `tsc --noEmit` clean for B6 files.
- No raw shadcn/Radix imports outside `packages/ui/**`.
- Branched from `origin/develop` (HEAD a8f41d3 — B2 merged).
