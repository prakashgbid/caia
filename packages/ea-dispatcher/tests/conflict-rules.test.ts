import { describe, it, expect } from 'vitest';
import {
  detectConflicts,
  SEMANTIC_CONFLICT_RULES,
  getPath,
} from '../src/conflict-rules.js';

describe('semantic conflict rules', () => {
  it('exports a non-empty rule set', () => {
    expect(SEMANTIC_CONFLICT_RULES.length).toBeGreaterThanOrEqual(10);
  });

  it('every rule declares fields and architects', () => {
    for (const r of SEMANTIC_CONFLICT_RULES) {
      expect(r.id).toBeTruthy();
      expect(r.architects.length).toBe(2);
      expect(r.fields.length).toBeGreaterThan(0);
      expect(typeof r.detect).toBe('function');
    }
  });

  it('rule ids are unique', () => {
    const ids = SEMANTIC_CONFLICT_RULES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('detect returns empty array for an empty composed blob', () => {
    expect(detectConflicts({})).toEqual([]);
  });

  it('image-lazy-vs-preload fires when SEO preloads a lazy-loaded image', () => {
    const composed = {
      'performance.lazyLoadList': [{ src: 'hero.jpg' }],
      'seo.preloadHints': [{ href: 'hero.jpg' }],
    };
    const fired = detectConflicts(composed).map((f) => f.rule.id);
    expect(fired).toContain('image-lazy-vs-preload');
  });

  it('image-lazy-vs-preload does NOT fire when sets are disjoint', () => {
    const composed = {
      'performance.lazyLoadList': [{ src: 'a.jpg' }],
      'seo.preloadHints': [{ href: 'b.jpg' }],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).not.toContain(
      'image-lazy-vs-preload',
    );
  });

  it('csp-frame-vs-iframe-embed fires when CSP forbids iframes but tree has one', () => {
    const composed = {
      'security.cspPolicy': { frameSrc: "'none'" },
      'frontend.componentTree': [{ kind: 'iframe-embed' }],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'csp-frame-vs-iframe-embed',
    );
  });

  it('csp-frame-vs-iframe-embed does NOT fire when no iframe widget', () => {
    const composed = {
      'security.cspPolicy': { frameSrc: "'none'" },
      'frontend.componentTree': [{ kind: 'button' }],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).not.toContain(
      'csp-frame-vs-iframe-embed',
    );
  });

  it('analytics-event-without-observability-metric fires for orphan event', () => {
    const composed = {
      'analytics.eventTaxonomy': [{ name: 'signup' }],
      'observability.metricsExport': [{ event: 'login' }],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'analytics-event-without-observability-metric',
    );
  });

  it('endpoint-without-gateway-ratelimit fires for unprotected endpoint', () => {
    const composed = {
      'backend.endpointEnumeration': [{ path: '/api/users' }],
      'apiGateway.rateLimit': [{ path: '/api/posts' }],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'endpoint-without-gateway-ratelimit',
    );
  });

  it('interactive-widget-without-keyboard-spec fires when keyboard missing', () => {
    const composed = {
      'frontend.componentTree': [{ id: 'btn-1', interactive: true }],
      'a11y.keyboardSpec': [],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'interactive-widget-without-keyboard-spec',
    );
  });

  it('flag-without-killswitch fires for unguarded flag', () => {
    const composed = {
      'featureFlags.flagStore': [{ name: 'newCheckout' }],
      'featureFlags.killSwitch': [],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'flag-without-killswitch',
    );
  });

  it('ab-test-without-flag-binding fires for missing flag', () => {
    const composed = {
      'abTesting.variantRouter': [{ flag: 'missing' }],
      'featureFlags.flagStore': [{ name: 'other' }],
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'ab-test-without-flag-binding',
    );
  });

  it('image-policy-vs-seo-og-image fires when OG image exceeds budget', () => {
    const composed = {
      'seo.ogImage': { sizeKb: 500 },
      'performance.imagePolicy': { maxKb: 200 },
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'image-policy-vs-seo-og-image',
    );
  });

  it('consent-vs-analytics-default fires on permissive consent + PII data', () => {
    const composed = {
      'analytics.consentMode': 'opt-in',
      'security.dataClassification': 'PII',
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'consent-vs-analytics-default',
    );
  });

  it('deploy-without-rollback fires when blue-green has no revert', () => {
    const composed = {
      'devops.deployStrategy': 'blue-green',
      'timeMachine.revertCommand': '',
    };
    expect(detectConflicts(composed).map((f) => f.rule.id)).toContain(
      'deploy-without-rollback',
    );
  });

  it('does not fire when fields are absent', () => {
    expect(detectConflicts({}).length).toBe(0);
  });

  it('a buggy rule predicate does not crash the detector', () => {
    const buggy = [
      ...SEMANTIC_CONFLICT_RULES,
      {
        id: 'boom',
        description: 'always throws',
        architects: ['a', 'b'] as [string, string],
        fields: ['x'],
        detect: () => {
          throw new Error('nope');
        },
      },
    ];
    // The buggy rule is silently dropped; the rest still run.
    const fired = detectConflicts(
      { 'performance.lazyLoadList': [{ src: 'x' }], 'seo.preloadHints': [{ href: 'x' }] },
      buggy,
    );
    expect(fired.map((f) => f.rule.id)).toContain('image-lazy-vs-preload');
    expect(fired.map((f) => f.rule.id)).not.toContain('boom');
  });
});

describe('getPath', () => {
  it('reads a flat dotted-key', () => {
    expect(getPath({ 'a.b': 1 }, 'a.b')).toBe(1);
  });

  it('falls back to nested lookup', () => {
    expect(getPath({ a: { b: 1 } }, 'a.b')).toBe(1);
  });

  it('returns undefined for missing paths', () => {
    expect(getPath({}, 'a.b')).toBeUndefined();
  });
});
