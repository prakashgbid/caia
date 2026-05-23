/**
 * `AnalyticsArchitectContract` — the canonical owned-fields declaration
 * for architect #8 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.8 (Analytics Architect owns `analytics.*`)
 *   - task brief (analyticsProvider, eventTaxonomy, userIdentificationStrategy,
 *     funnelDefinitions, consentGatingRules, customDimensions,
 *     dataResidencyRequirements, privacyCompliance)
 *
 * The reconciled superset below combines both the spec §2.8 fields and
 * the task brief's per-ticket-structure fields. Every field is
 * `required: true` because downstream consumers (A/B Testing reads
 * `eventTaxonomy` + `conversionGoals`; EA Reviewer reads `noPiiRule`
 * + `consentGatingRules` for the privacy-compliance lens) cascade on
 * missing fields.
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. The chosen keys all live under the `analytics.*`
 * namespace and do not collide with any sibling architect's namespace.
 */

import type {
  ArchitectMeta,
  ArchitectSectionContract,
  ArchitectSectionSpec,
  Ticket
} from './types.js';

// ─── Owned field set ────────────────────────────────────────────────────────

/**
 * Per-field operator fix-hints. The kit's `ArchitectSectionSpec` is
 * intentionally minimal (`path`, `description`, `required`); the fix-hint
 * dictionary lives next to the contract so the system-prompt builder and
 * the future EA Reviewer can surface it without changing kit shape.
 */
export const ANALYTICS_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'analytics.provider':
    'Default to {"primary":"plausible","secondary":"ga4"}. Plausible is cookieless (no consent gate); GA4 is consent-gated. Customer-chosen alternatives (PostHog, Mixpanel, Snowplow) override.',
  'analytics.eventTaxonomy':
    'For every interactive component in Frontend `interactionStates`, emit one event entry with {eventId, eventName, trigger, payloadSchema, consentRequired, noPii: true}. Stable snake_case event names.',
  'analytics.userIdentificationStrategy':
    'Default: anonymous (no userId fields). Pseudonymous (clientId hash) requires consent. Authenticated (userId from auth) requires authenticated session AND explicit consent. Never derive userId from PII (email hash, phone hash).',
  'analytics.funnelDefinitions':
    'Named conversion funnels: ordered sequences of event IDs from `eventTaxonomy`. Every funnel step ID must exist in the taxonomy. Default to one signup/conversion funnel + one engagement funnel per Page.',
  'analytics.consentMode':
    'Google Consent Mode v2 with default = {analytics_storage: denied, ad_storage: denied, functionality_storage: granted, security_storage: granted}. Update on consent grant.',
  'analytics.consentGatingRules':
    'Per-event-category prerequisite map: {category: requiredConsent}. Default cookieless events require none; cross-session/identified events require analytics_storage=granted.',
  'analytics.noPiiRule':
    'Explicit attestation that NO PII fields (email, phone, name, IP, precise-geo, full-userAgent) appear in any event payload. Provide regex denylist + per-event audit notes.',
  'analytics.privacyCompliance':
    'Posture object: {gdpr, ccpa, cookieBanner, dntRespect, gpcRespect, dataMinimisation, retentionDays}. Default: GDPR-compliant, CCPA-compliant, DNT respected (auto-deny), GPC respected (auto-deny), 14-month max retention.',
  'analytics.conversionGoals':
    'Primary metric ID + secondary metric IDs. Each must be a valid eventId from `eventTaxonomy`. A/B Testing Architect reads these to pick the experiment primary metric.',
  'analytics.dashboardLinks':
    'Per-environment dashboard URLs for each provider in `provider`. Example: {plausible:"https://plausible.io/<site>", ga4:"https://analytics.google.com/analytics/web/#/p<id>"}. Use placeholders if not yet provisioned.',
  'analytics.dataTrackAttributes':
    'HTML attribute conventions for the Frontend Architect: which `data-track-*` attributes encode {event, props, payload}. Per-component map keyed by Frontend componentId.',
  'analytics.sessionStrategy':
    'Session-stitching: {windowMinutes, identityTier, crossDomain, crossDevice}. Default: 30-min idle window, anonymous tier, no cross-domain, no cross-device.',
  'analytics.customDimensions':
    'Per-tenant dimensions / event params: {tenantId, planTier, persona, locale}. These are NEVER PII. Locale capped at 2-letter region code.',
  'analytics.dataResidencyRequirements':
    'Per-provider residency selection: {plausible:"eu", ga4:"<region>", posthog:"eu"}. Plausible defaults EU. GA4 inherits tenant residency. Document sub-processors + transfer mechanism.'
};

/**
 * The owned section specs in stable order.
 */
export const ANALYTICS_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'analytics.provider',
    description:
      'Analytics vendor stack: primary + secondary providers. Default: Plausible (cookieless) + GA4 (consent-gated). PostHog/Mixpanel/Snowplow accepted on customer request.',
    required: true
  },
  {
    path: 'analytics.eventTaxonomy',
    description:
      'Typed event names + payload schemas keyed by stable IDs. One entry per event-firing surface in Frontend `componentTree`. Every entry declares consent prerequisite + no-PII attestation.',
    required: true
  },
  {
    path: 'analytics.userIdentificationStrategy',
    description:
      'Anonymous / pseudonymous / authenticated tier policy. How userId/sessionId derive. Identity-stitching rules. PII is NEVER hashed into a userId.',
    required: true
  },
  {
    path: 'analytics.funnelDefinitions',
    description:
      'Named conversion funnels — ordered sequences of event IDs from `eventTaxonomy`. Consumed by the EA Reviewer + dashboards. A/B Testing references these for primary-metric eligibility.',
    required: true
  },
  {
    path: 'analytics.consentMode',
    description:
      'Google Consent Mode v2 binding + IAB TCF mapping (when applicable). Default state and grant/deny update rules.',
    required: true
  },
  {
    path: 'analytics.consentGatingRules',
    description:
      'Per-event-category consent prerequisite map (analytics_storage, ad_storage, functionality_storage, security_storage). Cookieless events allow `none`.',
    required: true
  },
  {
    path: 'analytics.noPiiRule',
    description:
      'Explicit no-PII attestation: regex denylist for email/phone/name/IP/precise-geo + per-event audit notes. Verified by the EA Reviewer privacy lens.',
    required: true
  },
  {
    path: 'analytics.privacyCompliance',
    description:
      'GDPR / CCPA / cookie-consent posture + DNT/GPC respect + data-minimisation + retention days. Drives the consent banner + footer disclosure.',
    required: true
  },
  {
    path: 'analytics.conversionGoals',
    description:
      'Primary + secondary conversion metric IDs. A/B Testing Architect consumes these for experiment design. Each must be a valid eventId.',
    required: true
  },
  {
    path: 'analytics.dashboardLinks',
    description:
      'Per-environment dashboard URLs for each provider. Operator-facing; surfaces in the EA dashboard widget.',
    required: true
  },
  {
    path: 'analytics.dataTrackAttributes',
    description:
      'HTML `data-track-*` attribute conventions per Frontend componentId. Frontend coding worker emits these literally; runtime tracker reads them.',
    required: true
  },
  {
    path: 'analytics.sessionStrategy',
    description:
      'Session-stitching window + identity tier + cross-domain/device rules. Default: 30-min idle window, anonymous tier.',
    required: true
  },
  {
    path: 'analytics.customDimensions',
    description:
      'Per-tenant custom dimensions / event params (tenantId, planTier, persona, locale). NEVER PII.',
    required: true
  },
  {
    path: 'analytics.dataResidencyRequirements',
    description:
      'Per-provider residency selection (EU/CA/US) + sub-processor list + transfer mechanism (SCC, adequacy decision).',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const ANALYTICS_OWNED_FIELD_KEYS: readonly string[] = ANALYTICS_OWNED_SECTIONS.map(
  s => s.path
);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.8 — Analytics runs on every ticket that produces UI (so it can
 * spec the events that fire from interactive widgets). The set matches
 * Frontend's `appliesPredicate` because Analytics is a per-UI
 * specialisation downstream of Frontend.
 */
export function analyticsArchitectAppliesPredicate(ticket: Ticket): boolean {
  return (
    ticket.type === 'Page' ||
    ticket.type === 'Widget' ||
    ticket.type === 'Story' ||
    ticket.type === 'Form' ||
    ticket.type === 'List'
  );
}

// ─── Architect meta ─────────────────────────────────────────────────────────

/**
 * Analytics is a wave-2 architect — depends on Frontend's
 * `componentTree` + `interactionStates`. Precedence rank 10 per the
 * canonical ladder in `@caia/architect-kit` (analytics is
 * compliance-sensitive because of consent gating). Above database (#11),
 * backend (#12), aiml (#13), frontend (#14); below security (#1),
 * devops (#2), a11y (#3), seo (#4), performance (#5), abTesting (#6),
 * featureFlagging (#7), apiGateway (#8), observability (#9).
 */
export const ANALYTICS_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['frontend'],
  precedenceLevel: 10,
  fanoutPolicy: 'always',
  appliesPredicate: analyticsArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const AnalyticsArchitectContract: ArchitectSectionContract = {
  contractId: 'analytics-architect.v1',
  architectName: 'analytics',
  version: '0.1.0',
  sections: ANALYTICS_OWNED_SECTIONS,
  architectMeta: ANALYTICS_ARCHITECT_META
};
