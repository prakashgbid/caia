# ADR-004: Analytics

**Date**: 2026-04-20
**Status**: Accepted
**Deciders**: Prakash (solo founder)

---

## Context

We need to track page views and user behavior events across all PokerZeno sites to understand content performance and guide SEO strategy. Requirements:

- Free (or near-free) for 20-150 sites
- Privacy compliant: GDPR and CCPA — consent must be obtained before tracking
- Centralized reporting: ideally one dashboard for all sites, not one per site
- Custom event tracking (quiz completions, tip saves, article scroll depth)
- Not injected at the hosting layer — must be controllable by the site code

---

## Decision

**Google Analytics 4** via the `@pokerzeno/analytics` wrapper package. No direct `gtag()` calls in site code.

Consent gate: no tracking fires before the user accepts the `ConsentBanner` component. Consent state is stored in `localStorage` under the key `pk_consent`. Value is `'accepted'` or `'declined'`. The ConsentBanner is rendered in `app/layout.tsx` on first visit.

```typescript
// CORRECT — always use the wrapper
import { trackEvent } from '@pokerzeno/analytics';
trackEvent('quiz_complete', { quiz_id: 'texas-holdem-basics', score: 8 });

// WRONG — never call gtag directly
window.gtag('event', 'quiz_complete', { ... });
```

The `@pokerzeno/analytics` package:
- Checks `localStorage.getItem('pk_consent') === 'accepted'` before every call
- Loads the GA4 script lazily (only after consent is given)
- Accepts a `GA4_MEASUREMENT_ID` env var: `NEXT_PUBLIC_GA4_ID`
- Exposes typed `trackEvent(name, params)` and `trackPageView()` functions

Each site gets its own GA4 Measurement ID. A cross-property roll-up is configured in the GA4 admin to aggregate data across all properties.

---

## Consequences

**Positive**:
- GA4 is free with no per-site pricing
- Cross-property reporting in GA4 admin gives a unified view across all sites
- Consent gate is baked into the framework — no site can accidentally track before consent
- GA4's event model is flexible enough for custom events (quiz scores, engagement depth)

**Negative / Trade-offs**:
- GA4 is a Google product — data is processed by Google. Accepted given the free tier benefit and GDPR compliance via consent gate
- Safari ITP (Intelligent Tracking Prevention) limits cookie lifetime to 7 days, reducing return visitor accuracy. Acceptable for our use case (content metrics, not e-commerce conversions)
- The consent banner adds friction on first visit. Mitigation: banner is minimal (two buttons, no toggles) and remembers the choice indefinitely

---

## Alternatives Considered

**Plausible Analytics** — rejected. $9/month per site or $19/month for 10 sites. At 150 sites, this is prohibitively expensive even with the "sites" limit on higher plans.

**Fathom Analytics** — rejected. Similar pricing model to Plausible. Good privacy story but cost doesn't scale.

**Self-hosted Matomo** — rejected. Requires a server and database per installation (or a single installation with multi-site, which requires server maintenance). Operational overhead for a solo founder.

**Cloudflare Web Analytics** — considered. Free, privacy-focused, no consent required (cookieless). Rejected because it lacks custom event tracking — we need quiz completions, tip saves, etc. Cloudflare's analytics is page-view-only.

**No analytics** — considered for low-priority sites. Rejected for now — understanding which content performs is critical for SEO strategy at scale.
