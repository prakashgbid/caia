# Phase B B1 — Wizard step error boundaries

## What this change does

Adds a Next.js App Router `error.tsx` to every wizard step segment
(7 in total: onboarding, grand-idea, interview, architecture, proposal,
design, atlas) plus a shared `<WizardStepErrorBoundary>` client component
that owns the recovery UX + tracing emission.

When a step segment throws (server-render or client-side error during a
commit), the framework mounts the segment's `error.tsx`, which mounts
the shared boundary. The boundary:

1. emits one OTel span via `@chiefaia/tracing` so the failure shows up
   in Tempo with the step slug + error name/message digest;
2. surfaces the `trace_id` in the recovery copy so customer-support
   can quote it back when the user contacts them;
3. renders three recovery CTAs — "Try again" (calls `reset()`),
   "Back to dashboard" (navigates to `/`), and "Contact support"
   (mailto with the trace_id pre-filled).

Materialises a new `app/wizard/architecture/` segment (page.tsx
placeholder + error.tsx) — previously the `architecture` slug was
served by the parent `[step]/page.tsx` dynamic fallback. Promoting it
to a first-class segment is the cleanest way to attach an error
boundary to it, and gives B6 (CriticFeedbackPanel + runIA wiring) a
landing pad without churning the dynamic fallback.

## Surface added

```
apps/wizard/components/wizard/WizardStepErrorBoundary.tsx   # shared boundary
apps/wizard/app/wizard/onboarding/error.tsx                 # per-step shim
apps/wizard/app/wizard/grand-idea/error.tsx                 # per-step shim
apps/wizard/app/wizard/interview/error.tsx                  # per-step shim
apps/wizard/app/wizard/architecture/page.tsx                # NEW segment
apps/wizard/app/wizard/architecture/error.tsx               # per-step shim
apps/wizard/app/wizard/proposal/error.tsx                   # per-step shim
apps/wizard/app/wizard/design/error.tsx                     # per-step shim
apps/wizard/app/wizard/atlas/error.tsx                      # per-step shim
```

Plus `tests/wizard-shell/wizard-steps/error-boundary.test.tsx`
with 18 vitest cases.

## Reuse-first

| Need | Existing package consumed |
|---|---|
| UI primitives (Card, CardHeader, CardTitle, CardDescription, CardContent, Button) | `@caia/ui` |
| OTel tracing (createTracer / startSpan with attributes + status) | `@chiefaia/tracing` v0.3.0 |
| Step slug + title catalogue | `lib/wizard/steps.ts` (canonical, B5 ships it) |

No raw shadcn/Radix/Tailwind imports outside `packages/ui/**`. No
parallel `@chiefaia/otel`. No raw `next/router` — recovery actions use
test-injectable seams + `window.location.assign('/')`.

## Tests

18 vitest cases in `tests/wizard-shell/wizard-steps/error-boundary.test.tsx`:

- **Rendering (5)**: step-specific title, stable test-id, trace_id
  surfaced, three recovery CTAs present, distinct title per slug.
- **Recovery actions (5)**: Try-again fires `reset` by default,
  `onResetClick` test seam overrides it, `onDashboardClick` test seam
  on Back-to-dashboard, mailto has trace_id pre-filled, custom
  supportEmail respected.
- **Tracing (8)**: exactly one span per mount, semantic attributes set
  (caia.wizard.step, error.name, error.message), digest captured when
  present, omitted when absent, span marked error status with message,
  message truncated past 200 chars, no duplicate spans on re-render
  with same error, tracer created with step-scoped service name.

Pre-existing failures on develop (B7/B3/B5 modules not transpiled in
the local pnpm graph — `@chiefaia/claude-spawner` + `@opentelemetry/api`
resolve errors and TS2352 on `tests/wizard-shell/edge-bypass.test.ts`)
are unchanged — none of B1's diff touches those files.

## Subscription-only

The boundary never instantiates an HTTP client, never sets API keys,
never reaches a remote service. It emits OTel spans that the Wave-1
init bootstrap routes to Tempo, and it builds a `mailto:` URL — both
of which are subscription-free.

## True-Zero readiness

- Local `pnpm exec vitest run tests/.../error-boundary.test.tsx` →
  18/18 pass.
- Local `tsc --noEmit` → no new errors (pre-existing list unchanged).
- No raw shadcn/Radix imports outside `packages/ui/**`.
- Branched from `origin/develop` (HEAD 746cdbe at time of cut).
