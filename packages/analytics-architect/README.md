# @caia/analytics-architect

Architect #8 of CAIA's 17-architect EA fan-out. Senior analytics engineer focused on **privacy-compliant tracking**, cookieless analytics, event-taxonomy design, and consent gating.

## What it owns

`analytics.*` slice of the `tickets.architecture` JSONB column:

- `analytics.provider` — analytics vendor stack (Plausible / GA4 / PostHog / customer's choice). Default: Plausible (cookieless, no-consent) + GA4 (consent-gated).
- `analytics.eventTaxonomy` — typed event names + payload schemas keyed by stable IDs, with explicit no-PII attestation per event.
- `analytics.userIdentificationStrategy` — anonymous / pseudonymous / authenticated tier policy; how userId/sessionId derive; identity-stitching rules.
- `analytics.funnelDefinitions` — named conversion funnels (sequences of event IDs) for the EA Reviewer + dashboards.
- `analytics.consentMode` — Google Consent Mode v2 / IAB TCF binding + default state (deny until granted).
- `analytics.consentGatingRules` — per-event-category consent prerequisite map (analytics_storage, ad_storage, functionality_storage, …).
- `analytics.noPiiRule` — explicit attestation + per-payload regex assertions that no PII (email/phone/name/IP/precise-geo) appears in any event.
- `analytics.privacyCompliance` — GDPR / CCPA / cookie-consent posture, DNT/GPC respect, EU/CA data-residency notes.
- `analytics.conversionGoals` — primary + secondary metric IDs the A/B Testing Architect consumes downstream.
- `analytics.dashboardLinks` — Plausible/GA4/PostHog dashboard URLs scoped per environment.
- `analytics.dataTrackAttributes` — `data-track-*` HTML attribute conventions for the Frontend Architect's components.
- `analytics.sessionStrategy` — session-stitching window, identity tier, cross-domain rules.
- `analytics.customDimensions` — per-tenant custom dimensions / event params (tenantId, planTier, persona, locale).
- `analytics.dataResidencyRequirements` — EU/CA/US residency selection per provider, sub-processor list, transfer mechanism.

## What it does NOT do

**No component code.** Frontend Architect writes JSX. This architect specifies which events fire from which components and what they capture. **No backend logic.** Backend Architect owns API endpoints; Analytics declares what is tracked, not how it's persisted. **No funnels SQL.** Funnel definitions are stable IDs the dashboarding tier interprets. Out-of-namespace writes are rejected.

## How it runs

Implements `SpecialistArchitect` (per spec `research/17_architect_framework_spec_2026.md` §1 + §2.8). **Wave 2** — depends on Frontend Architect's `componentTree` + `interactionStates` to know which surfaces should emit events. Sonnet by default. Tools empty for V1.

The architect leverages patterns from the existing `@chiefaia/analytics` wrapper (Plausible + GA4 + consent banner) — see V2 §2 "wrap" verdict. The wrapper is the runtime; this architect is the design surface.

## Quick start

```ts
import { AnalyticsArchitect, AnalyticsArchitectContract } from '@caia/analytics-architect';

const architect = new AnalyticsArchitect();
const output = await architect.run({
  ticket, businessPlan, designVersion, tenantContext,
  upstream: { outputs: { frontend: frontendOutput } }, // REQUIRED for analytics
  budget: {
    maxInputTokens: 60_000, maxOutputTokens: 8_000,
    maxWallClockMs: 60_000, preferredModel: 'sonnet',
    hardCostCeilingUsd: 0.5,
  }
});
```

## Testing

```bash
pnpm test        # full Vitest suite (≥30 tests including golden privacy-compliance test)
pnpm typecheck   # tsc --noEmit
pnpm build       # emit dist/
pnpm lint        # eslint src tests
```

The test suite includes interface compliance, contract structural checks, registration disjointness, output validation, run() idempotency, dependency declaration (`depends on frontend`), cross-architect invariants, and an end-to-end **golden privacy-compliance test** that locks the no-PII-without-consent invariant for a known prakash-tiwari Widget ticket.

## Notes

- Architect name is `"analytics"`. The owned-field namespace is `analytics.*` (matches the canonical precedence ladder entry).
- Precedence rank **10** — analytics is compliance-sensitive (consent gating, residency). Above observability (#9), below API gateway (#8) / observability operability. Below Security (#1) / DevOps (#2) / A11y (#3) / SEO (#4) / Perf (#5) / A/B Testing (#6) / Feature Flags (#7).
- V1 ships with **zero tools**. The architect reads the upstream Frontend componentTree directly and emits per-component event specifications. A future `caia-event-schema-validator` MCP will let the architect statically verify event payloads against a typed registry.
- **Privacy by default.** Every event must declare a `consent` prerequisite (`none` only for cookieless / first-party-only providers like Plausible). PII fields (email, phone, name, IP, precise-geo) are forbidden in event payloads unless `consent.level === 'authenticated'` AND the field is `consent.fields[<field>] === true`.
