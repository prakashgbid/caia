/**
 * Cross-architect invariants — verifies Analytics's contributions to the
 * EA Reviewer's invariant registry (per spec §6.2).
 *
 * Includes the golden privacy-compliance test: no PII in events without
 * explicit consent grants.
 */

import { describe, it, expect } from 'vitest';

import { ANALYTICS_INVARIANTS } from '../src/invariants.js';
import { composedArchitectureForInvariants, goldenExpectedOutput } from './helpers/fakes.js';

describe('ANALYTICS_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(ANALYTICS_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of ANALYTICS_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `analytics`', () => {
    for (const inv of ANALYTICS_INVARIANTS) {
      expect(inv.contributor).toBe('analytics');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of ANALYTICS_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of ANALYTICS_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of ANALYTICS_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('ANALYTICS_INVARIANTS — predicate behaviour against the golden fixture', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output', () => {
    for (const inv of ANALYTICS_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden fixture`).toBe(true);
    }
  });

  it('consentMode-default-denied fails when analytics_storage default is granted', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.consentMode-default-denied');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.consentMode': {
        version: 'v2',
        default: { analytics_storage: 'granted', ad_storage: 'denied' }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('noPii-attested fails when attestation is missing', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.noPii-attested');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.noPiiRule': { attested: false, denylistRegex: [] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('eventTaxonomy-no-pii-payloads fails when an event payload has an email field', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.eventTaxonomy-no-pii-payloads');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.eventTaxonomy': {
        leaky_event: {
          eventName: 'leaky_event',
          trigger: 'form:submit',
          payloadSchema: { email: 'string', planTier: 'string' },
          consentRequired: 'analytics_storage',
          noPii: true,
          category: 'conversion'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('eventTaxonomy-no-pii-payloads fails when an event payload has a phone field', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.eventTaxonomy-no-pii-payloads');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.eventTaxonomy': {
        leaky_event: {
          eventName: 'leaky_event',
          trigger: 'form:submit',
          payloadSchema: { phoneNumber: 'string' },
          consentRequired: 'analytics_storage',
          noPii: true,
          category: 'conversion'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('eventTaxonomy-no-pii-payloads fails when an event payload has a precise-geo field', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.eventTaxonomy-no-pii-payloads');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.eventTaxonomy': {
        located_event: {
          eventName: 'located_event',
          trigger: 'geo:resolved',
          payloadSchema: { latitude: 'number', longitude: 'number' },
          consentRequired: 'analytics_storage',
          noPii: true,
          category: 'engagement'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('eventTaxonomy-every-event-attests-noPii fails when noPii=false somewhere', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.eventTaxonomy-every-event-attests-noPii'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.eventTaxonomy': {
        sketchy_event: {
          eventName: 'sketchy_event',
          trigger: 'x:y',
          payloadSchema: {},
          consentRequired: 'analytics_storage',
          noPii: false,
          category: 'engagement'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('eventTaxonomy-consentRequired-allowlist fails on an unknown bucket', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.eventTaxonomy-consentRequired-allowlist'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.eventTaxonomy': {
        wrong_bucket: {
          eventName: 'wrong_bucket',
          trigger: 'x:y',
          payloadSchema: {},
          consentRequired: 'NOT_A_BUCKET',
          noPii: true,
          category: 'engagement'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('funnelDefinitions-steps-exist-in-taxonomy fails on a dangling step ID', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.funnelDefinitions-steps-exist-in-taxonomy'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.funnelDefinitions': {
        broken_funnel: { name: 'broken', steps: ['page_view', 'made_up_event'], window: '7d' }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('conversionGoals-exist-in-taxonomy fails on an unknown primary metric', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.conversionGoals-exist-in-taxonomy'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.conversionGoals': { primary: 'made_up_event', secondary: [] }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('privacy-dnt-and-gpc-respected fails when DNT respect is off', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.privacy-dnt-and-gpc-respected');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.privacyCompliance': {
        gdpr: true,
        ccpa: true,
        cookieBanner: true,
        dntRespect: false,
        gpcRespect: true,
        dataMinimisation: true,
        retentionDays: 425
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('privacy-dnt-and-gpc-respected fails when GPC respect is off', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.privacy-dnt-and-gpc-respected');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.privacyCompliance': {
        gdpr: true,
        ccpa: true,
        cookieBanner: true,
        dntRespect: true,
        gpcRespect: false,
        dataMinimisation: true,
        retentionDays: 425
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('privacy-retention-under-425d fails when retentionDays > 425', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.privacy-retention-under-425d');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.privacyCompliance': {
        ...((goldenArch['analytics.privacyCompliance'] as object) ?? {}),
        retentionDays: 730
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('customDimensions-no-pii fails when a dimension declares pii=true', () => {
    const inv = ANALYTICS_INVARIANTS.find(i => i.id === 'analytics.customDimensions-no-pii');
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.customDimensions': {
        tenantId: { scope: 'event-or-user', pii: false },
        emailHash: { scope: 'user', pii: true }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('userId-strategy-default-anonymous fails when default tier is pseudonymous', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.userId-strategy-default-anonymous'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'analytics.userIdentificationStrategy': {
        defaultTier: 'pseudonymous',
        tiers: {}
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });
});

describe('ANALYTICS_INVARIANTS — composed (with Frontend) view', () => {
  it('dataTrackAttributes-cover-interactive-components passes when all interactive components are covered', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.dataTrackAttributes-cover-interactive-components'
    );
    expect(inv).toBeDefined();
    const composed = composedArchitectureForInvariants();
    expect(inv!.detect(composed)).toBe(true);
  });

  it('dataTrackAttributes-cover-interactive-components fails when one component is missing', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.dataTrackAttributes-cover-interactive-components'
    );
    expect(inv).toBeDefined();
    const composed = { ...composedArchitectureForInvariants() };
    composed['analytics.dataTrackAttributes'] = {
      'hero-cta-primary': (composed['analytics.dataTrackAttributes'] as Record<string, unknown>)[
        'hero-cta-primary'
      ]
    };
    expect(inv!.detect(composed)).toBe(false);
  });

  it('eventTaxonomy-covers-interactive-components advisory fires on a dangling data-track-event reference', () => {
    const inv = ANALYTICS_INVARIANTS.find(
      i => i.id === 'analytics.eventTaxonomy-covers-interactive-components'
    );
    expect(inv).toBeDefined();
    const composed = { ...composedArchitectureForInvariants() };
    composed['analytics.dataTrackAttributes'] = {
      'hero-cta-primary': { 'data-track-event': 'NONEXISTENT_EVENT', 'data-track-payload': '{}' }
    };
    expect(inv!.detect(composed)).toBe(false);
  });
});
