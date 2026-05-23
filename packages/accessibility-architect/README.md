# @caia/accessibility-architect

Architect #5 of CAIA's 17-architect EA fan-out. Senior accessibility engineer focused on **WCAG 2.2 AA**, axe-core findings, keyboard navigation, and screen-reader UX.

## What it owns

`a11y.*` slice of the `tickets.architecture` JSONB column:

- `a11y.wcagLevel` — target compliance level (locked to `2.2 AA` for V1)
- `a11y.ariaRoles` — per-component ARIA roles (only when native semantics are insufficient)
- `a11y.ariaLabels` — accessible-name source per interactive component (aria-label, aria-labelledby, visible text)
- `a11y.keyboardNavigationPlan` — Tab order, arrow-key semantics for composite widgets, Escape/Enter/Space contracts
- `a11y.focusManagementNotes` — focus trap, focus return, initial focus, focus ring spec per component
- `a11y.colorContrastRequirements` — per-token contrast floors (4.5:1 body text, 3:1 graphical/large text, 3:1 UI components)
- `a11y.screenReaderAnnouncementPoints` — live-region map (polite/assertive), state-change announcements
- `a11y.reducedMotionConsiderations` — animations that gate on `prefers-reduced-motion`, alternatives
- `a11y.formAccessibilitySpec` — label association, error announcement, required indicator, autocomplete tokens

## What it does NOT do

**No component code.** Frontend Architect writes JSX. This architect specifies the exact `aria-*` attributes Frontend must include. No CSS. No database. No API. Out-of-namespace writes are rejected.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1 + §2.5). **Wave 2** — depends on Frontend Architect's `componentTree` + `interactionStates` to know which components to spec. Sonnet by default. Tools empty for V1; later: `caia-axe-core` MCP for runtime audit.

## Quick start

```ts
import { AccessibilityArchitect, AccessibilityArchitectContract } from '@caia/accessibility-architect';

const architect = new AccessibilityArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { frontend: frontendOutput } }, // REQUIRED for accessibility
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests including golden)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, dependency declaration (`depends on frontend`), cross-architect invariants, and an end-to-end golden test that locks the WCAG 2.2 AA spec for a known prakash-tiwari Widget ticket.

## Notes

- Architect name is `"accessibility"`. The owned-field namespace is `a11y.*` (per spec §2.5 and the `accessibility → a11y` alias declared in `@caia/ea-dispatcher`'s `fieldBelongsTo` resolver).
- Precedence rank **3** — accessibility is treated as a legal-exposure concern. Above Frontend (#14), SEO (#4), and Performance (#5). Below Security (#1) and DevOps (#2).
- V1 ships with **zero tools**. The architect reads the upstream Frontend componentTree directly and emits per-component aria specifications. A future `caia-axe-core` MCP will let the architect run axe-core against a synthesized HTML preview.
