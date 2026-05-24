/**
 * Golden test — the canonical known-good Analytics-architect artifact
 * for a known prakash-tiwari Widget ticket. Includes the
 * **golden privacy-compliance test** (no PII in events without consent).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { AnalyticsArchitect } from '../../src/architect.js';
import { ANALYTICS_OWNED_FIELD_KEYS } from '../../src/contract.js';
import { ANALYTICS_INVARIANTS } from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

const PII_FIELD_PATTERNS = [
  /email/i,
  /phone/i,
  /firstname|first_name/i,
  /lastname|last_name/i,
  /\bname\b/i,
  /\bssn\b/i,
  /passport/i,
  /address/i,
  /^ip$|ipv4|ipv6|ip_addr/i,
  /precise.?geo|\blat\b|\blng\b|longitude|latitude/i,
  /full.?user.?agent/i,
  /credit.?card|card.?number/i,
  /\bdob\b|date.?of.?birth/i
];

function containsPiiFieldName(obj: unknown): string | null {
  if (typeof obj !== 'object' || obj === null) return null;
  for (const key of Object.keys(obj as Record<string, unknown>)) {
    for (const pat of PII_FIELD_PATTERNS) {
      if (pat.test(key)) return key;
    }
  }
  return null;
}

describe('golden — prakash-tiwari Artist hero bio Widget ticket', () => {
  it('input-ticket.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(readFileSync(resolve(__dirname, 'input-ticket.json'), 'utf-8'));
    const fixture = buildFakeInput().ticket;
    expect(raw).toEqual(fixture);
  });

  it('input-businessplan.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-businessplan.json'), 'utf-8')
    );
    const fixture = buildFakeInput().businessPlan;
    expect(raw).toEqual(fixture);
  });

  it('input-designversion.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-designversion.json'), 'utf-8')
    );
    const fixture = buildFakeInput().designVersion;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(goldenAssistantText(), ANALYTICS_OWNED_FIELD_KEYS);
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new AnalyticsArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    expect(out.architectName).toBe('analytics');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    for (const k of ANALYTICS_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every Analytics invariant', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new AnalyticsArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of ANALYTICS_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden output`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new AnalyticsArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });
});

/**
 * Golden privacy-compliance lens — locks the EA Reviewer's no-PII-
 * without-consent invariant against the canonical fixture. This is the
 * test the operator referenced in the task brief ("golden test
 * verifying privacy-compliance posture (no PII in events without
 * consent)").
 */
describe('GOLDEN PRIVACY-COMPLIANCE LENS — no PII in events without consent', () => {
  const arch = goldenExpectedOutput().architectureFields;
  const taxonomy = arch['analytics.eventTaxonomy'] as Record<string, Record<string, unknown>>;
  const consentMode = arch['analytics.consentMode'] as Record<string, unknown>;
  const privacyCompliance = arch['analytics.privacyCompliance'] as Record<string, unknown>;
  const noPiiRule = arch['analytics.noPiiRule'] as Record<string, unknown>;
  const customDimensions = arch['analytics.customDimensions'] as Record<
    string,
    Record<string, unknown>
  >;
  const userIdStrategy = arch['analytics.userIdentificationStrategy'] as Record<string, unknown>;

  it('Consent Mode v2 default state denies analytics_storage', () => {
    const def = consentMode.default as Record<string, unknown>;
    expect(def.analytics_storage).toBe('denied');
  });

  it('Consent Mode v2 default state denies ad_storage', () => {
    const def = consentMode.default as Record<string, unknown>;
    expect(def.ad_storage).toBe('denied');
  });

  it('Consent Mode v2 default state grants functionality_storage (necessary cookies only)', () => {
    const def = consentMode.default as Record<string, unknown>;
    expect(def.functionality_storage).toBe('granted');
  });

  it('every event in the taxonomy attests noPii=true', () => {
    for (const [eventId, event] of Object.entries(taxonomy)) {
      expect(event.noPii, `event ${eventId} must attest noPii=true`).toBe(true);
    }
  });

  it('no event payloadSchema contains a PII field name', () => {
    for (const [eventId, event] of Object.entries(taxonomy)) {
      const piiField = containsPiiFieldName(event.payloadSchema);
      expect(piiField, `event ${eventId} payload contains PII field: ${piiField ?? ''}`).toBeNull();
    }
  });

  it('cookieless events (consentRequired=none) carry no user-identifying fields', () => {
    for (const [eventId, event] of Object.entries(taxonomy)) {
      if (event.consentRequired !== 'none') continue;
      const schema = event.payloadSchema as Record<string, unknown>;
      expect(schema, `event ${eventId} schema must exist`).toBeDefined();
      expect(
        Object.keys(schema).some(k => /^userId$|clientId|sessionId|deviceId/.test(k)),
        `cookieless event ${eventId} carries an identifier field`
      ).toBe(false);
    }
  });

  it('DNT and GPC signals are both respected (auto-deny)', () => {
    expect(privacyCompliance.dntRespect).toBe(true);
    expect(privacyCompliance.gpcRespect).toBe(true);
  });

  it('retention ceiling is GDPR-compliant (≤ 14 months ≈ 425 days)', () => {
    expect(privacyCompliance.retentionDays).toBeLessThanOrEqual(425);
  });

  it('noPiiRule is explicitly attested with a non-empty regex denylist', () => {
    expect(noPiiRule.attested).toBe(true);
    expect(Array.isArray(noPiiRule.denylistRegex)).toBe(true);
    expect((noPiiRule.denylistRegex as unknown[]).length).toBeGreaterThan(0);
  });

  it('customDimensions never carry PII (every dimension has pii=false)', () => {
    for (const [dimName, dim] of Object.entries(customDimensions)) {
      expect(dim.pii, `custom dimension ${dimName} must set pii=false`).toBe(false);
    }
  });

  it('default identification tier is anonymous (no clientId until consent)', () => {
    expect(userIdStrategy.defaultTier).toBe('anonymous');
  });

  it('authenticated tier declares an empty piiAllowedFields list (no PII allowed even on consent)', () => {
    const tiers = userIdStrategy.tiers as Record<string, Record<string, unknown>>;
    expect(tiers.authenticated.piiAllowedFields).toEqual([]);
  });

  it('GDPR and CCPA compliance are both asserted true', () => {
    expect(privacyCompliance.gdpr).toBe(true);
    expect(privacyCompliance.ccpa).toBe(true);
  });

  it('data residency selects EU for EU-resident tenants', () => {
    const residency = arch['analytics.dataResidencyRequirements'] as Record<
      string,
      Record<string, unknown>
    >;
    expect(residency.plausible.region).toBe('eu');
    expect(['europe-west', 'eu', 'EU']).toContain(residency.ga4.region);
  });

  it('every IAB TCF integration is explicitly opt-in (default off)', () => {
    expect(consentMode.iabTcf).toBe(false);
  });
});
