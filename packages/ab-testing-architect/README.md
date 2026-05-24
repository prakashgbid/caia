# @caia/ab-testing-architect

Architect #13 of CAIA's 17-architect EA fan-out. Senior experimentation engineer focused on **A/B testing rigor** — hypothesis framing, sample-size power calculations, sequential/Bayesian/frequentist readout, variant routing, holdout analysis.

## What it owns

`abTesting.*` slice of the `tickets.architecture` JSONB column:

- `abTesting.experimentDesign` — hypothesis statement + primary metric + guardrail metric IDs + expected effect size + minimum-detectable-effect + baseline conversion rate + direction.
- `abTesting.variantRoutingStrategy` — sticky-by-user-id (default), sticky-session, percentage, or geographic. Includes hash seed + salt + stickiness key + per-variant allocations.
- `abTesting.sampleSizeRequirements` — perVariantN + totalN + power-calc method + alpha + power + MDE + baseline + estimated duration days.
- `abTesting.randomizationUnit` — user (default), session, or pageview.
- `abTesting.holdoutAnalysisPlan` — holdout group definition + percentage (default 5%) + duration + analysis cadence + success criteria.
- `abTesting.statisticalReadoutMethod` — frequentist (default), Bayesian, or sequential (O'Brien-Fleming / Pocock).
- `abTesting.experimentLifecycle` — state machine draft → running → analysis → decided → archived, with per-transition gate checks.
- `abTesting.featureFlagDependencies` — forward-references to Feature Flagging Architect: flag key, expected shape, required variants, kill switch, default variant on disable.
- `abTesting.primaryMetric` — eventId (must exist in upstream `analytics.eventTaxonomy`), metric type, aggregation, success direction.
- `abTesting.secondaryMetrics` — non-blocking metrics tracked alongside the primary.
- `abTesting.guardrailMetrics` — guardrails that BLOCK winner promotion if violated (latency, error rate, core engagement).
- `abTesting.allocation` — traffic allocation (default 50/50). Sum MUST equal 100.
- `abTesting.winnerPromotionPolicy` — auto-promote only when ALL of {p<α, SRM pass, min duration met, guardrails respected, sample-size floor reached}.
- `abTesting.durationCap` — 28-day hard-stop per spec §2.13.
- `abTesting.srmCheck` — Sample-Ratio-Mismatch check (always enabled, α=0.001, daily).

## What it does NOT do

**No component code.** Frontend Architect writes JSX. **No backend logic.** Backend Architect owns API endpoints; A/B Testing declares how experiments are designed, sized, and analyzed. **No event taxonomy.** Analytics Architect owns events; A/B Testing picks metric IDs from the existing taxonomy. **No flag schema.** Feature Flagging Architect owns the flag store; A/B Testing forward-references flag keys. Out-of-namespace writes are rejected.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1 + §2.13). **Wave 3 — the lone wave-3 architect** — depends on Analytics's `eventTaxonomy` + `funnelDefinitions` + `conversionGoals` AND Feature Flagging's `flagsSchema`. Sonnet by default. Tools empty for V1 (the `caia-power-calc` MCP tool is a planned V2 addition).

The architect leverages patterns from the existing `@caia/analytics` and `@caia/feature-registry` packages — see V2 §2 "wrap" verdict. Those packages are the runtime; this architect is the design surface.

## Quick start

```ts
import { ABTestingArchitect, ABTestingArchitectContract } from '@caia/ab-testing-architect';

const architect = new ABTestingArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: {
    analytics: analyticsOutput,            // REQUIRED — provides eventTaxonomy
    featureFlagging: featureFlaggingOutput // REQUIRED — provides flagsSchema
  } },
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Statistical defaults

- **Test**: two-proportion z-test (α=0.05 two-tailed, power=0.8).
- **Variant router**: sticky-by-user-id via stable hash (FNV-1a / MurmurHash3) seeded per experiment.
- **Sample-Ratio-Mismatch (SRM)**: always enabled, α=0.001, daily, halt-and-alert on failure.
- **Holdout**: 5% global, never exposed to the winning variant, 90-day post-promotion analysis.
- **Duration cap**: 28 days hard-stop.
- **Auto-promote**: ALL of {p < α, SRM pass, min duration met, guardrails respected, sample-size floor reached}.
- **Randomization unit**: user (default), session for anonymous flows, pageview for cosmetic-only experiments.

## Owned by

CAIA EA fan-out — wave-3 — precedence rank 6 (statistical correctness outranks operability; ranks below security/devops/a11y/seo/performance because incorrect-but-significant experiment results are recoverable while a security breach is not).
