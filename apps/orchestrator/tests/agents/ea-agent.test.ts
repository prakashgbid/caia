/**
 * BUCKET-003 — EA Agent unit tests.
 *
 * Cover the pure helpers (tech sub-domain inference, quality tags, risk,
 * effort, blocked-by parser, claims inference, mutual-exclusion validator)
 * — not the DB integration; that's covered by the BUCKET-006 E2E.
 */

import {
  inferTechSubDomains,
  inferQualityTags,
  inferRisk,
  inferEffort,
  inferBlockedBy,
  inferClaims,
  validateTaxonomyInvariants,
} from '../../src/agents/ea-agent';

describe('inferTechSubDomains', () => {
  it('uses primary-domain seed when text is sparse', () => {
    const r = inferTechSubDomains('Add OAuth2 login', 'auth');
    expect(r.primary).toBe('auth');
    expect(r.all).toContain('auth');
  });

  it('detects database work', () => {
    const r = inferTechSubDomains('Add a drizzle migration for the new schema', 'data-storage');
    expect(r.all).toContain('database');
    expect(r.primary).toBe('database');
  });

  it('detects multiple tech sub-domains and orders by score', () => {
    const r = inferTechSubDomains(
      'Build a React component that calls /api/billing and renders an invoice',
      'ui-frontend',
    );
    expect(r.all).toContain('frontend');
    // The seed bonus lands frontend first.
    expect(r.primary).toBe('frontend');
  });

  it('falls back to backend when nothing matches', () => {
    const r = inferTechSubDomains('lorem ipsum dolor sit amet', 'business-logic');
    expect(r.primary).toBe('backend');
    expect(r.all).toEqual(['backend']);
  });

  it('caps tech sub-domains at 5', () => {
    const longText =
      'react component, drizzle migration, cron schedule, observability metric, ' +
      'wcag compliance, sentry alert, vault secret, ga4 analytics, sendgrid email';
    const r = inferTechSubDomains(longText, 'ui-frontend');
    expect(r.all.length).toBeLessThanOrEqual(5);
  });
});

describe('inferQualityTags', () => {
  it('detects accessibility', () => {
    expect(inferQualityTags('must meet WCAG 2.2 AA with aria roles')).toContain('accessibility');
  });
  it('detects seo', () => {
    expect(inferQualityTags('add canonical URL and og: meta tags')).toContain('seo');
  });
  it('detects performance', () => {
    expect(inferQualityTags('improve lighthouse score and bundle size')).toContain('performance');
  });
  it('detects security', () => {
    expect(inferQualityTags('add CSP header and threat model')).toContain('security');
  });
  it('detects compliance', () => {
    expect(inferQualityTags('GDPR compliance audit trail')).toContain('compliance');
  });
  it('detects observability', () => {
    expect(inferQualityTags('add tracing and structured logging')).toContain('observability');
  });
  it('detects internationalization', () => {
    expect(inferQualityTags('add i18n translation pipeline')).toContain('internationalization');
  });
  it('returns [] when no quality concerns mentioned', () => {
    expect(inferQualityTags('add a billing tab')).toEqual([]);
  });
});

describe('inferRisk', () => {
  it('returns critical for data-migration tech', () => {
    expect(inferRisk(['data-migration'], [], 'new')).toBe('critical');
  });
  it('returns high when auth is touched', () => {
    expect(inferRisk(['auth'], [], 'new')).toBe('high');
  });
  it('returns high when payments is touched', () => {
    expect(inferRisk(['payments'], [], 'new')).toBe('high');
  });
  it('returns high for hotfix lifecycle regardless', () => {
    expect(inferRisk(['frontend'], [], 'hotfix')).toBe('high');
  });
  it('returns high when compliance quality tag is set', () => {
    expect(inferRisk(['frontend'], ['compliance'], 'new')).toBe('high');
  });
  it('returns low for docs lifecycle', () => {
    expect(inferRisk(['documentation'], [], 'docs')).toBe('low');
  });
  it('returns low for chore lifecycle', () => {
    expect(inferRisk(['ci-cd'], [], 'chore')).toBe('low');
  });
  it('returns medium otherwise', () => {
    expect(inferRisk(['frontend'], [], 'new')).toBe('medium');
  });
});

describe('inferEffort', () => {
  it('maps classifier complexity to effort', () => {
    expect(inferEffort('x', 'trivial')).toBe('XS');
    expect(inferEffort('x', 'small')).toBe('S');
    expect(inferEffort('x', 'medium')).toBe('M');
    expect(inferEffort('x', 'large')).toBe('L');
    expect(inferEffort('x', 'xl')).toBe('XL');
  });

  it('falls back to word count when classifier returns unknown', () => {
    expect(inferEffort('one two three', 'unknown')).toBe('XS');
    expect(inferEffort('a b c d e f g h i j', 'unknown')).toBe('S');
    expect(inferEffort(Array(50).fill('word').join(' '), 'unknown')).toBe('M');
    expect(inferEffort(Array(150).fill('word').join(' '), 'unknown')).toBe('L');
    expect(inferEffort(Array(300).fill('word').join(' '), 'unknown')).toBe('XL');
  });
});

describe('inferBlockedBy', () => {
  it('returns [] when no markers present', () => {
    expect(inferBlockedBy('build a feature')).toEqual([]);
  });

  it('detects "after #STORY-X"', () => {
    expect(inferBlockedBy('do this after #story-foo-001')).toEqual(['story-foo-001']);
  });

  it('detects "depends on STORY-X"', () => {
    expect(inferBlockedBy('depends on story-bar-002')).toEqual(['story-bar-002']);
  });

  it('detects "blocked by STORY-X"', () => {
    expect(inferBlockedBy('this is blocked by #story-baz-003')).toEqual(['story-baz-003']);
  });

  it('deduplicates repeated markers', () => {
    const r = inferBlockedBy('after #story-x-1 and after #story-x-1');
    expect(r).toEqual(['story-x-1']);
  });

  it('finds multiple distinct markers', () => {
    const r = inferBlockedBy(
      'depends on story-a-1 and after #story-b-2 and blocked by story-c-3',
    );
    expect(r).toContain('story-a-1');
    expect(r).toContain('story-b-2');
    expect(r).toContain('story-c-3');
  });
});

describe('inferClaims', () => {
  it('finds files mentioned in text', () => {
    const r = inferClaims(
      'edit apps/orchestrator/src/agents/po-agent.ts',
      ['agent-runtime'],
    );
    expect(r.files).toContain('apps/orchestrator/src/agents/po-agent.ts');
  });

  it('finds API routes', () => {
    const r = inferClaims('add POST /api/billing endpoint', ['bff']);
    expect(r.apiRoutes.some((r) => r.includes('/api/billing'))).toBe(true);
  });

  it('finds schema columns', () => {
    const r = inferClaims('add stories.tech_sub_domain_primary column', ['database']);
    expect(r.schemas.some((s) => s.includes('stories.'))).toBe(true);
  });

  it('coarse-fallback domains = techAll', () => {
    const r = inferClaims('lorem', ['frontend', 'bff']);
    expect(r.domains).toEqual(['frontend', 'bff']);
  });
});

describe('validateTaxonomyInvariants', () => {
  it('flags effort=XL', () => {
    const v = validateTaxonomyInvariants({
      effort: 'XL',
      risk: 'medium',
      priorityBucket: 'P2',
      lifecycle: 'new',
    });
    expect(v.some((e) => e.field === 'effort')).toBe(true);
  });

  it('flags critical risk + low priority', () => {
    const v = validateTaxonomyInvariants({
      effort: 'M',
      risk: 'critical',
      priorityBucket: 'P3',
      lifecycle: 'new',
    });
    expect(v.some((e) => e.field === 'priorityBucket')).toBe(true);
  });

  it('accepts critical risk + P0', () => {
    const v = validateTaxonomyInvariants({
      effort: 'M',
      risk: 'critical',
      priorityBucket: 'P0',
      lifecycle: 'new',
    });
    expect(v.length).toBe(0);
  });

  it('flags lifecycle=spike + effort=L', () => {
    const v = validateTaxonomyInvariants({
      effort: 'L',
      risk: 'medium',
      priorityBucket: 'P2',
      lifecycle: 'spike',
    });
    expect(v.some((e) => e.field === 'effort' && /spike/.test(e.message))).toBe(true);
  });

  it('returns [] for valid combinations', () => {
    const v = validateTaxonomyInvariants({
      effort: 'M',
      risk: 'medium',
      priorityBucket: 'P2',
      lifecycle: 'new',
    });
    expect(v).toEqual([]);
  });
});
