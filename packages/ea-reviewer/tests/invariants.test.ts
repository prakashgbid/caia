import { describe, it, expect } from 'vitest';
import {
  REVIEWER_INVARIANTS,
  runConsistencyLens,
  type Invariant,
} from '../src/invariants.js';
import { cleanComposedArchitecture } from './fixtures.js';

describe('REVIEWER_INVARIANTS registry', () => {
  it('exports a non-empty invariant set', () => {
    expect(REVIEWER_INVARIANTS.length).toBeGreaterThanOrEqual(10);
  });

  it('every invariant has id, description, blame, and predicate', () => {
    for (const inv of REVIEWER_INVARIANTS) {
      expect(inv.id).toBeTruthy();
      expect(inv.description).toBeTruthy();
      expect(inv.blameArchitects.length).toBeGreaterThan(0);
      expect(typeof inv.holds).toBe('function');
    }
  });

  it('invariant ids are unique', () => {
    const ids = REVIEWER_INVARIANTS.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('runConsistencyLens — clean fixture', () => {
  it('produces zero findings on a fully-clean composed architecture', () => {
    const findings = runConsistencyLens(cleanComposedArchitecture());
    expect(findings).toEqual([]);
  });

  it('returns empty array on empty architecture (vacuously true)', () => {
    expect(runConsistencyLens({})).toEqual([]);
  });
});

describe('individual invariants — failure cases', () => {
  function only(id: string): readonly Invariant[] {
    return REVIEWER_INVARIANTS.filter((i) => i.id === id);
  }

  it('every-endpoint-has-gateway-policy fires for uncovered endpoint', () => {
    const findings = runConsistencyLens(
      {
        'backend.endpointEnumeration': [{ path: '/a' }, { path: '/b' }],
        'apiGateway.rateLimit': [{ path: '/a' }],
      },
      { invariants: only('every-endpoint-has-gateway-policy') },
    );
    expect(findings.length).toBe(1);
    expect(findings[0]?.invariantId).toBe('every-endpoint-has-gateway-policy');
    expect(findings[0]?.blameArchitects).toContain('apiGateway');
  });

  it('every-event-has-metric fires for orphan event', () => {
    const findings = runConsistencyLens(
      {
        'analytics.eventTaxonomy': [{ name: 'a' }, { name: 'b' }],
        'observability.metricsExport': [{ event: 'a' }],
      },
      { invariants: only('every-event-has-metric') },
    );
    expect(findings.length).toBe(1);
  });

  it('interactive-widgets-have-keyboard-spec fires when keyboard missing', () => {
    const findings = runConsistencyLens(
      {
        'frontend.componentTree': [{ id: 'b1', interactive: true }],
        'a11y.keyboardSpec': [],
      },
      { invariants: only('interactive-widgets-have-keyboard-spec') },
    );
    expect(findings.length).toBe(1);
  });

  it('csp-allows-iframes-if-tree-has-them fires when CSP forbids', () => {
    const findings = runConsistencyLens(
      {
        'frontend.componentTree': [{ kind: 'iframe-embed' }],
        'security.cspPolicy': { frameSrc: "'none'" },
      },
      { invariants: only('csp-allows-iframes-if-tree-has-them') },
    );
    expect(findings.length).toBe(1);
  });

  it('every-feature-flag-has-killswitch fires for unguarded flag', () => {
    const findings = runConsistencyLens(
      {
        'featureFlags.flagStore': [{ name: 'a' }, { name: 'b' }],
        'featureFlags.killSwitch': [{ name: 'a' }],
      },
      { invariants: only('every-feature-flag-has-killswitch') },
    );
    expect(findings.length).toBe(1);
  });

  it('ab-test-variants-bind-to-flags fires for missing flag', () => {
    const findings = runConsistencyLens(
      {
        'abTesting.variantRouter': [{ flag: 'ghost' }],
        'featureFlags.flagStore': [{ name: 'real' }],
      },
      { invariants: only('ab-test-variants-bind-to-flags') },
    );
    expect(findings.length).toBe(1);
  });

  it('preload-and-lazy-load-are-disjoint fires on overlap', () => {
    const findings = runConsistencyLens(
      {
        'seo.preloadHints': [{ href: 'hero.jpg' }],
        'performance.lazyLoadList': [{ src: 'hero.jpg' }],
      },
      { invariants: only('preload-and-lazy-load-are-disjoint') },
    );
    expect(findings.length).toBe(1);
    expect(findings[0]?.blameArchitects).toEqual(['seo', 'performance']);
  });

  it('database-schema-references-only-known-engines fires on unknown', () => {
    const findings = runConsistencyLens(
      { 'database.engine': 'cassandra' },
      { invariants: only('database-schema-references-only-known-engines') },
    );
    expect(findings.length).toBe(1);
  });

  it('devops-blue-green-implies-time-machine-revert fires on missing revert', () => {
    const findings = runConsistencyLens(
      {
        'devops.deployStrategy': 'blue-green',
        'timeMachine.revertCommand': '',
      },
      { invariants: only('devops-blue-green-implies-time-machine-revert') },
    );
    expect(findings.length).toBe(1);
  });

  it('pii-data-requires-deny-by-default-consent fires on permissive consent', () => {
    const findings = runConsistencyLens(
      {
        'security.dataClassification': 'PII',
        'analytics.consentMode': 'opt-in',
      },
      { invariants: only('pii-data-requires-deny-by-default-consent') },
    );
    expect(findings.length).toBe(1);
  });

  it('every-endpoint-has-fixture fires when no fixture matches', () => {
    const findings = runConsistencyLens(
      {
        'backend.endpointEnumeration': [{ path: '/api/x' }],
        'testing.fixtures': [{ path: '/api/y' }],
      },
      { invariants: only('every-endpoint-has-fixture') },
    );
    expect(findings.length).toBe(1);
  });

  it('observability-logs-are-non-empty-when-backend-present fires on empty logs', () => {
    const findings = runConsistencyLens(
      {
        'backend.framework': 'express',
        'observability.logShape': '',
      },
      { invariants: only('observability-logs-are-non-empty-when-backend-present') },
    );
    expect(findings.length).toBe(1);
  });

  it('a11y-wcag-level-is-aa-or-aaa fires on level A', () => {
    const findings = runConsistencyLens(
      { 'a11y.wcagLevel': 'A' },
      { invariants: only('a11y-wcag-level-is-aa-or-aaa') },
    );
    expect(findings.length).toBe(1);
  });

  it('performance-lighthouse-targets-are-numeric fires on string value', () => {
    const findings = runConsistencyLens(
      { 'performance.lighthouseTargets': { perf: 'fast' } },
      { invariants: only('performance-lighthouse-targets-are-numeric') },
    );
    expect(findings.length).toBe(1);
  });

  it('seo-canonical-is-https fires on http URL', () => {
    const findings = runConsistencyLens(
      { 'seo.canonical': 'http://example.com' },
      { invariants: only('seo-canonical-is-https') },
    );
    expect(findings.length).toBe(1);
  });
});

describe('runConsistencyLens — runner behavior', () => {
  it('survives a buggy invariant predicate', () => {
    const buggy: Invariant = {
      id: 'boom',
      description: 'always throws',
      blameArchitects: ['frontend'],
      holds: () => {
        throw new Error('boom');
      },
    };
    const findings = runConsistencyLens({}, { invariants: [buggy] });
    expect(findings).toEqual([]);
  });

  it('honors a custom severity', () => {
    const findings = runConsistencyLens(
      {
        'backend.endpointEnumeration': [{ path: '/a' }],
        'apiGateway.rateLimit': [],
      },
      { severity: 'P0' },
    );
    expect(findings[0]?.severity).toBe('P0');
  });
});
