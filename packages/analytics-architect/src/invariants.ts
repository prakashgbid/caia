/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Analytics's contributions so the
 * Reviewer's `invariants-registry.ts` (which doesn't exist yet — sibling
 * brief F2) can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'analytics.eventTaxonomy'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `analytics.*` path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Analytics package's own tests AND
 * inside the Reviewer's post-composition pass.
 *
 * Cross-architect invariants (those that read fields owned by another
 * architect) treat absent foreign data as "cannot verify" and pass
 * trivially. The Reviewer's composed-output pass will exercise the
 * real check; the per-architect test pass exercises only the local
 * checks. This keeps unit tests on the Analytics output green even
 * though frontend.* fields aren't present.
 *
 * True ⇒ pass; false ⇒ a Reviewer advisory or fail (driven by `severity`).
 */

export type InvariantSeverity = 'fail' | 'advisory';

export interface ArchitectInvariant {
  id: string;
  /** Architect that contributed this invariant. */
  contributor: string;
  /** Other architects whose fields this invariant reads. */
  reads: readonly string[];
  /** Severity if the predicate returns false. */
  severity: InvariantSeverity;
  /** Operator-facing description for the Reviewer's audit log. */
  description: string;
  /**
   * The predicate. Receives the JSONB blob (flat-keyed
   * `architectureFields` view OR nested composed-architecture view).
   * Pure + synchronous.
   */
  detect(architecture: Readonly<Record<string, unknown>>): boolean;
}

/**
 * Read a field from the architecture blob. Tries the flat dotted key
 * first (matches `architectureFields` shape), then falls back to walking
 * the nested object path (matches composed-architecture shape).
 */
function readField(arch: Readonly<Record<string, unknown>>, path: string): unknown {
  if (path in arch) return arch[path];
  const parts = path.split('.');
  let cursor: unknown = arch;
  for (const part of parts) {
    if (typeof cursor !== 'object' || cursor === null) return undefined;
    cursor = (cursor as Record<string, unknown>)[part];
  }
  return cursor;
}

/**
 * PII denylist — fields whose name OR value pattern suggests PII.
 * Used by the no-PII-without-consent invariant. The system prompt
 * carries the literal regex set; this invariant enforces field-name
 * checks because most PII leaks come from naming a field `email` or
 * `phoneNumber` and forgetting to redact.
 */
const PII_FIELD_NAME_PATTERNS: readonly RegExp[] = [
  /email/i,
  /phone/i,
  /firstname|first_name/i,
  /lastname|last_name/i,
  /\bname\b/i,
  /\bssn\b/i,
  /passport/i,
  /address/i,
  /^ip$|ipv4|ipv6|ip_addr/i,
  /precise.?geo|lat|lng|longitude|latitude/i,
  /full.?user.?agent/i,
  /credit.?card|card.?number/i,
  /\bdob\b|date.?of.?birth/i
];

/**
 * Check whether a payloadSchema (object map of fieldName → typeDescriptor)
 * contains any field whose NAME matches a PII pattern.
 */
function payloadSchemaHasPii(schema: unknown): boolean {
  if (typeof schema !== 'object' || schema === null) return false;
  for (const key of Object.keys(schema as Record<string, unknown>)) {
    for (const pat of PII_FIELD_NAME_PATTERNS) {
      if (pat.test(key)) return true;
    }
  }
  return false;
}

/**
 * Analytics's contributed invariants. Listed in stable order.
 */
export const ANALYTICS_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'analytics.consentMode-default-denied',
    contributor: 'analytics',
    reads: ['analytics.consentMode'],
    severity: 'fail',
    description:
      'Google Consent Mode v2 default state MUST deny `analytics_storage` until the user grants. Allowing analytics_storage by default violates GDPR + CCPA.',
    detect(arch): boolean {
      const mode = readField(arch, 'analytics.consentMode');
      if (typeof mode !== 'object' || mode === null) return false;
      const def = (mode as Record<string, unknown>).default;
      if (typeof def !== 'object' || def === null) return false;
      return (def as Record<string, unknown>).analytics_storage === 'denied';
    }
  },
  {
    id: 'analytics.noPii-attested',
    contributor: 'analytics',
    reads: ['analytics.noPiiRule'],
    severity: 'fail',
    description:
      'The analytics output MUST explicitly attest noPiiRule.attested === true. Absent attestation blocks the EA Reviewer privacy lens.',
    detect(arch): boolean {
      const rule = readField(arch, 'analytics.noPiiRule');
      if (typeof rule !== 'object' || rule === null) return false;
      return (rule as Record<string, unknown>).attested === true;
    }
  },
  {
    id: 'analytics.eventTaxonomy-no-pii-payloads',
    contributor: 'analytics',
    reads: ['analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'No event in `analytics.eventTaxonomy` may carry PII field names (email, phone, name, ip, precise-geo, ...) in its payloadSchema. Hashed PII is still PII.',
    detect(arch): boolean {
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (typeof tax !== 'object' || tax === null) return true;
      for (const entry of Object.values(tax as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const schema = (entry as Record<string, unknown>).payloadSchema;
        if (payloadSchemaHasPii(schema)) return false;
      }
      return true;
    }
  },
  {
    id: 'analytics.eventTaxonomy-every-event-attests-noPii',
    contributor: 'analytics',
    reads: ['analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'Every event in `analytics.eventTaxonomy` MUST set `noPii: true`. Per-event attestation is the contract the runtime tracker honours.',
    detect(arch): boolean {
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (typeof tax !== 'object' || tax === null) return true;
      for (const entry of Object.values(tax as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) return false;
        if ((entry as Record<string, unknown>).noPii !== true) return false;
      }
      return true;
    }
  },
  {
    id: 'analytics.eventTaxonomy-consentRequired-allowlist',
    contributor: 'analytics',
    reads: ['analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'Every event must declare consentRequired ∈ {"none","analytics_storage","ad_storage","functionality_storage"}. Other values are not Consent-Mode-v2 buckets.',
    detect(arch): boolean {
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (typeof tax !== 'object' || tax === null) return true;
      const allowed = new Set([
        'none',
        'analytics_storage',
        'ad_storage',
        'functionality_storage'
      ]);
      for (const entry of Object.values(tax as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) return false;
        const c = (entry as Record<string, unknown>).consentRequired;
        if (typeof c !== 'string' || !allowed.has(c)) return false;
      }
      return true;
    }
  },
  {
    id: 'analytics.funnelDefinitions-steps-exist-in-taxonomy',
    contributor: 'analytics',
    reads: ['analytics.funnelDefinitions', 'analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'Every step ID in `analytics.funnelDefinitions[*].steps` must exist in `analytics.eventTaxonomy`. Dangling references break funnel analysis.',
    detect(arch): boolean {
      const funnels = readField(arch, 'analytics.funnelDefinitions');
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (typeof funnels !== 'object' || funnels === null) return true;
      if (typeof tax !== 'object' || tax === null) return false;
      const eventIds = new Set(Object.keys(tax as Record<string, unknown>));
      for (const f of Object.values(funnels as Record<string, unknown>)) {
        if (typeof f !== 'object' || f === null) continue;
        const steps = (f as Record<string, unknown>).steps;
        if (!Array.isArray(steps)) return false;
        for (const s of steps) {
          if (typeof s !== 'string' || !eventIds.has(s)) return false;
        }
      }
      return true;
    }
  },
  {
    id: 'analytics.conversionGoals-exist-in-taxonomy',
    contributor: 'analytics',
    reads: ['analytics.conversionGoals', 'analytics.eventTaxonomy'],
    severity: 'fail',
    description:
      'Primary + secondary conversion goal IDs must exist in `analytics.eventTaxonomy`. Otherwise the A/B Testing Architect cannot bind to them.',
    detect(arch): boolean {
      const goals = readField(arch, 'analytics.conversionGoals');
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (typeof goals !== 'object' || goals === null) return true;
      if (typeof tax !== 'object' || tax === null) return false;
      const eventIds = new Set(Object.keys(tax as Record<string, unknown>));
      const g = goals as Record<string, unknown>;
      if (typeof g.primary !== 'string' || !eventIds.has(g.primary)) return false;
      const secondary = g.secondary;
      if (!Array.isArray(secondary)) return true;
      for (const s of secondary) {
        if (typeof s !== 'string' || !eventIds.has(s)) return false;
      }
      return true;
    }
  },
  {
    id: 'analytics.privacy-dnt-and-gpc-respected',
    contributor: 'analytics',
    reads: ['analytics.privacyCompliance'],
    severity: 'fail',
    description:
      '`analytics.privacyCompliance` MUST set both dntRespect=true and gpcRespect=true. Auto-deny for DNT/GPC signals is non-negotiable.',
    detect(arch): boolean {
      const pc = readField(arch, 'analytics.privacyCompliance');
      if (typeof pc !== 'object' || pc === null) return false;
      const o = pc as Record<string, unknown>;
      return o.dntRespect === true && o.gpcRespect === true;
    }
  },
  {
    id: 'analytics.privacy-retention-under-425d',
    contributor: 'analytics',
    reads: ['analytics.privacyCompliance'],
    severity: 'fail',
    description:
      'Retention ceiling is 14 months (≈425 days). Higher values violate GDPR data-minimisation defaults.',
    detect(arch): boolean {
      const pc = readField(arch, 'analytics.privacyCompliance');
      if (typeof pc !== 'object' || pc === null) return true;
      const r = (pc as Record<string, unknown>).retentionDays;
      if (typeof r !== 'number') return false;
      return r <= 425;
    }
  },
  {
    id: 'analytics.dataTrackAttributes-cover-interactive-components',
    contributor: 'analytics',
    reads: ['analytics.dataTrackAttributes', 'frontend.interactionStates'],
    severity: 'fail',
    description:
      'Every interactive component declared in Frontend `interactionStates` must have a matching entry in `analytics.dataTrackAttributes`. Trivially passes if the Frontend output is absent (cross-arch invariant — Reviewer runs against the composed output).',
    detect(arch): boolean {
      const attrs = readField(arch, 'analytics.dataTrackAttributes');
      const interactives = readField(arch, 'frontend.interactionStates');
      if (typeof interactives !== 'object' || interactives === null) return true;
      if (typeof attrs !== 'object' || attrs === null) return false;
      const attrKeys = new Set(Object.keys(attrs as Record<string, unknown>));
      for (const compId of Object.keys(interactives as Record<string, unknown>)) {
        if (!attrKeys.has(compId)) return false;
      }
      return true;
    }
  },
  {
    id: 'analytics.eventTaxonomy-covers-interactive-components',
    contributor: 'analytics',
    reads: ['analytics.eventTaxonomy', 'analytics.dataTrackAttributes', 'frontend.interactionStates'],
    severity: 'advisory',
    description:
      'Every dataTrackAttributes entry should reference an eventId that exists in eventTaxonomy. Mismatches mean the runtime tracker dispatches an unknown event.',
    detect(arch): boolean {
      const attrs = readField(arch, 'analytics.dataTrackAttributes');
      const tax = readField(arch, 'analytics.eventTaxonomy');
      if (typeof attrs !== 'object' || attrs === null) return true;
      if (typeof tax !== 'object' || tax === null) return false;
      const eventIds = new Set(Object.keys(tax as Record<string, unknown>));
      for (const entry of Object.values(attrs as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) continue;
        const ref = (entry as Record<string, unknown>)['data-track-event'];
        if (typeof ref !== 'string') continue;
        if (!eventIds.has(ref)) return false;
      }
      return true;
    }
  },
  {
    id: 'analytics.customDimensions-no-pii',
    contributor: 'analytics',
    reads: ['analytics.customDimensions'],
    severity: 'fail',
    description:
      'Every entry in `analytics.customDimensions` MUST set `pii: false`. Custom dimensions become permanent per-user attributes; PII contamination is irreversible.',
    detect(arch): boolean {
      const dims = readField(arch, 'analytics.customDimensions');
      if (typeof dims !== 'object' || dims === null) return true;
      for (const entry of Object.values(dims as Record<string, unknown>)) {
        if (typeof entry !== 'object' || entry === null) return false;
        if ((entry as Record<string, unknown>).pii !== false) return false;
      }
      return true;
    }
  },
  {
    id: 'analytics.userId-strategy-default-anonymous',
    contributor: 'analytics',
    reads: ['analytics.userIdentificationStrategy'],
    severity: 'fail',
    description:
      'Default identification tier MUST be "anonymous". Pseudonymous/authenticated tiers require explicit consent grants.',
    detect(arch): boolean {
      const s = readField(arch, 'analytics.userIdentificationStrategy');
      if (typeof s !== 'object' || s === null) return false;
      return (s as Record<string, unknown>).defaultTier === 'anonymous';
    }
  }
];
