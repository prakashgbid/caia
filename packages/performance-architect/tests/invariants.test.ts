/**
 * Cross-architect invariants — verifies Performance's contributions
 * to the EA Reviewer's invariant registry (per spec §6.2).
 *
 * Each invariant is exercised against:
 *   1. The pure Performance output (cross-arch invariants pass trivially
 *      when foreign data is absent).
 *   2. A composed view (Performance + Frontend fields) — the realistic
 *      Reviewer shape. Cross-arch invariants are fully exercised here.
 *   3. Corruption variants — each invariant must fail on its known-bad
 *      input shape.
 */

import { describe, it, expect } from 'vitest';

import {
  CWV_GOOD_THRESHOLDS,
  LIGHTHOUSE_FLOORS,
  PERFORMANCE_INVARIANTS
} from '../src/invariants.js';
import {
  composedArchitectureForInvariants,
  goldenExpectedOutput
} from './helpers/fakes.js';

describe('PERFORMANCE_INVARIANTS — structural', () => {
  it('declares at least one invariant', () => {
    expect(PERFORMANCE_INVARIANTS.length).toBeGreaterThan(0);
  });

  it('every invariant has a stable id', () => {
    const seen = new Set<string>();
    for (const inv of PERFORMANCE_INVARIANTS) {
      expect(inv.id.length).toBeGreaterThan(0);
      expect(seen.has(inv.id)).toBe(false);
      seen.add(inv.id);
    }
  });

  it('every invariant is contributed by `performance`', () => {
    for (const inv of PERFORMANCE_INVARIANTS) {
      expect(inv.contributor).toBe('performance');
    }
  });

  it('every invariant declares a non-empty `reads` list', () => {
    for (const inv of PERFORMANCE_INVARIANTS) {
      expect(inv.reads.length).toBeGreaterThan(0);
    }
  });

  it('every invariant has a valid severity', () => {
    for (const inv of PERFORMANCE_INVARIANTS) {
      expect(['fail', 'advisory']).toContain(inv.severity);
    }
  });

  it('every invariant has a non-empty description', () => {
    for (const inv of PERFORMANCE_INVARIANTS) {
      expect(inv.description.length).toBeGreaterThan(20);
    }
  });
});

describe('PERFORMANCE_INVARIANTS — locked constants', () => {
  it('CWV "Good" thresholds match Google guidance', () => {
    expect(CWV_GOOD_THRESHOLDS.lcpMs).toBe(2500);
    expect(CWV_GOOD_THRESHOLDS.inpMs).toBe(200);
    expect(CWV_GOOD_THRESHOLDS.cls).toBe(0.1);
    expect(CWV_GOOD_THRESHOLDS.ttfbMs).toBe(800);
  });

  it('Lighthouse floors match the locked playbook', () => {
    expect(LIGHTHOUSE_FLOORS.performance).toBe(90);
    expect(LIGHTHOUSE_FLOORS.seo).toBe(95);
    expect(LIGHTHOUSE_FLOORS.accessibility).toBe(95);
    expect(LIGHTHOUSE_FLOORS.bestPractices).toBe(90);
  });
});

describe('PERFORMANCE_INVARIANTS — predicate behaviour on the golden Perf output', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;

  it('every invariant passes against the canonical good output (cross-arch checks trivially pass without Frontend data)', () => {
    for (const inv of PERFORMANCE_INVARIANTS) {
      const ok = inv.detect(goldenArch);
      expect(ok, `invariant ${inv.id} should pass on the golden Perf output`).toBe(true);
    }
  });
});

describe('PERFORMANCE_INVARIANTS — predicate behaviour on the composed (Perf + Frontend) view', () => {
  const composed = composedArchitectureForInvariants();

  it('every invariant passes against the composed view', () => {
    for (const inv of PERFORMANCE_INVARIANTS) {
      const ok = inv.detect(composed);
      expect(ok, `invariant ${inv.id} should pass on the composed view`).toBe(true);
    }
  });
});

describe('PERFORMANCE_INVARIANTS — corruption variants', () => {
  const goldenArch = goldenExpectedOutput().architectureFields;
  const composed = composedArchitectureForInvariants();

  it('coreWebVitalsBudgets-mobile-lcp-good fails when LCP exceeds 4000ms', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.coreWebVitalsBudgets-mobile-lcp-good'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.coreWebVitalsBudgets': {
        pageType: 'admin',
        mobile: { lcpMs: 5000, inpMs: 200, cls: 0.1, ttfbMs: 800 },
        desktop: { lcpMs: 5000, inpMs: 200, cls: 0.1, ttfbMs: 600 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('coreWebVitalsBudgets-mobile-inp-good fails when INP exceeds 500ms', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.coreWebVitalsBudgets-mobile-inp-good'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.coreWebVitalsBudgets': {
        pageType: 'story',
        mobile: { lcpMs: 2500, inpMs: 700, cls: 0.1, ttfbMs: 800 },
        desktop: { lcpMs: 2500, inpMs: 700, cls: 0.1, ttfbMs: 600 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('coreWebVitalsBudgets-mobile-cls-good fails when CLS exceeds 0.25', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.coreWebVitalsBudgets-mobile-cls-good'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.coreWebVitalsBudgets': {
        pageType: 'story',
        mobile: { lcpMs: 2500, inpMs: 200, cls: 0.3, ttfbMs: 800 },
        desktop: { lcpMs: 2500, inpMs: 200, cls: 0.3, ttfbMs: 600 }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('lighthouseBudgets-performance-at-least-90 fails when Perf < 90', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.lighthouseBudgets-performance-at-least-90'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.lighthouseBudgets': {
        performance: 85,
        seo: 95,
        accessibility: 95,
        bestPractices: 90,
        pwa: null
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('lighthouseBudgets-categories-at-locked-floors fails when SEO drops to 90', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.lighthouseBudgets-categories-at-locked-floors'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.lighthouseBudgets': {
        performance: 90,
        seo: 90, // below the 95 floor
        accessibility: 95,
        bestPractices: 90,
        pwa: null
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('bundleSizeBudget-route-under-250kb-gzip fails when route exceeds 250KB', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.bundleSizeBudget-route-under-250kb-gzip'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.bundleSizeBudget': {
        routeChunkKb: { gzip: 400, brotli: 320 },
        sharedBaselineKb: { gzip: 80, brotli: 68 },
        thirdPartyBudgetKb: 0,
        perAssetCeilingKb: 50
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('imagePlan-formats-include-avif-or-webp fails when only JPEG is declared', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.imagePlan-formats-include-avif-or-webp'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.imageOptimizationPlan': {
        formats: ['jpeg'],
        breakpoints: [640, 750, 1080, 1920],
        lcpCandidate: 'hero-portrait',
        priorityComponents: [],
        lazyComponents: [],
        defaultSizes: '',
        placeholder: 'empty'
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('fontPlan-display-swap-or-optional fails on `block`', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.fontPlan-display-swap-or-optional'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.fontOptimizationPlan': {
        loader: 'next/font',
        display: 'block',
        preload: [],
        subset: ['latin'],
        variableAxes: [],
        selfHosted: true,
        thirdPartyAllow: []
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('fontPlan-self-hosted fails when selfHosted is false', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.fontPlan-self-hosted'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.fontOptimizationPlan': {
        loader: 'next/font',
        display: 'swap',
        preload: [],
        subset: ['latin'],
        variableAxes: [],
        selfHosted: false,
        thirdPartyAllow: ['Google Fonts']
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('lazyLoad-references-real-components fails when a referenced id is missing from componentTree', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.lazyLoad-references-real-components'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...composed,
      'performance.lazyLoadStrategy': {
        'phantom-component': {
          strategy: 'eager',
          rootMargin: null,
          reason: 'above-fold'
        }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('criticalRenderPath-lcp-anchor-matches-image-plan fails when anchors diverge', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.criticalRenderPath-lcp-anchor-matches-image-plan'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.criticalRenderPath': {
        preload: [],
        prefetch: [],
        deferredScripts: [],
        inlineCriticalCssKb: 8,
        lcpAnchor: 'hero-title', // different from imagePlan lcpCandidate
        renderBlocking: []
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('cacheStrategy-tri-tier-populated fails when the CDN tier is missing', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.cacheStrategy-tri-tier-populated'
    );
    expect(inv).toBeDefined();
    const corrupted = {
      ...goldenArch,
      'performance.cacheStrategy': {
        // cdn missing
        browser: { static: 'x', html: 'y' },
        server: { revalidateSec: 60, isr: true }
      }
    };
    expect(inv!.detect(corrupted)).toBe(false);
  });

  it('coreWebVitalsBudgets-mobile-lcp-good passes when LCP is exactly 2500ms (Good threshold)', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.coreWebVitalsBudgets-mobile-lcp-good'
    );
    const ok = {
      ...goldenArch,
      'performance.coreWebVitalsBudgets': {
        pageType: 'marketing',
        mobile: { lcpMs: 2500, inpMs: 200, cls: 0.1, ttfbMs: 800 },
        desktop: { lcpMs: 2500, inpMs: 200, cls: 0.1, ttfbMs: 600 }
      }
    };
    expect(inv!.detect(ok)).toBe(true);
  });

  it('fontPlan-display-swap-or-optional accepts `optional`', () => {
    const inv = PERFORMANCE_INVARIANTS.find(
      i => i.id === 'performance.fontPlan-display-swap-or-optional'
    );
    const ok = {
      ...goldenArch,
      'performance.fontOptimizationPlan': {
        loader: 'next/font',
        display: 'optional',
        preload: [],
        subset: ['latin'],
        variableAxes: [],
        selfHosted: true,
        thirdPartyAllow: []
      }
    };
    expect(inv!.detect(ok)).toBe(true);
  });
});
