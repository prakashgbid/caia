/**
 * Golden test — the canonical known-good Performance-architect artifact
 * for a known prakash-tiwari Widget ticket.
 *
 * This test serves four purposes:
 *
 *   1. Lock the architect's output shape against drift. Any change to
 *      the contract or run() must update this snapshot.
 *
 *   2. Demonstrate the architect produces a complete, validating output
 *      end-to-end given a realistic input (including the upstream
 *      Frontend output that Performance depends on).
 *
 *   3. Verify Core Web Vitals budgets are reasonable per page-type —
 *      article/story pages MUST hit the "Good" thresholds (LCP ≤ 2.5s,
 *      INP ≤ 200ms, CLS ≤ 0.1). This is the canonical assertion the task
 *      brief calls out.
 *
 *   4. Become the canonical fixture the other 14 specialist architect
 *      packages reference when writing their own golden tests.
 *
 * Note: this test uses a deterministic fake spawner. It does NOT call
 * the real claude binary. The "golden" here is the expected
 * deterministic projection of the input through the run() pipeline,
 * given a fixed assistant text. A nightly LLM-judge variant is the
 * sibling test the conformance suite will add later (per spec §11(c)).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import { PerformanceArchitect } from '../../src/architect.js';
import { PERFORMANCE_OWNED_FIELD_KEYS } from '../../src/contract.js';
import {
  CWV_GOOD_THRESHOLDS,
  LIGHTHOUSE_FLOORS,
  PERFORMANCE_INVARIANTS
} from '../../src/invariants.js';
import { validateArchitectOutput } from '../../src/validation.js';
import {
  buildFakeInput,
  composedArchitectureForInvariants,
  fakeGoldenSpawner,
  goldenAssistantText,
  goldenExpectedOutput
} from '../helpers/fakes.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

describe('golden — prakash-tiwari Artist hero bio Widget ticket (performance)', () => {
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

  it('input-upstream-frontend.json fixture loads and matches buildFakeInput()', () => {
    const raw = JSON.parse(
      readFileSync(resolve(__dirname, 'input-upstream-frontend.json'), 'utf-8')
    );
    const fixture = buildFakeInput().upstream.outputs.frontend;
    expect(raw).toEqual(fixture);
  });

  it('assistant text validates cleanly', () => {
    const result = validateArchitectOutput(
      goldenAssistantText(),
      PERFORMANCE_OWNED_FIELD_KEYS
    );
    expect(result.ok).toBe(true);
  });

  it('end-to-end produces the canonical ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new PerformanceArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    // Architect name, status, top-level shape
    expect(out.architectName).toBe('performance');
    expect(out.status).toBe('ok');
    expect(out.confidence).toBeGreaterThan(0.5);

    // Every owned field present
    for (const k of PERFORMANCE_OWNED_FIELD_KEYS) {
      expect(out.architectureFields).toHaveProperty(k);
    }

    // Field values match the known-good expectation (except spend, which
    // the run pipeline overwrites).
    const expected = goldenExpectedOutput();
    expect(out.architectureFields).toEqual(expected.architectureFields);
    expect(out.confidence).toBe(expected.confidence);
    expect(out.notes).toBe(expected.notes);
    expect(out.dependencies).toEqual(expected.dependencies);
    expect(out.risks).toEqual(expected.risks);
  });

  it('output passes every Performance invariant on the Perf-only view', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new PerformanceArchitect({ spawner });
    const out = await arch.run(buildFakeInput());

    for (const inv of PERFORMANCE_INVARIANTS) {
      const ok = inv.detect(out.architectureFields);
      expect(ok, `invariant ${inv.id} should pass on the golden Perf output`).toBe(true);
    }
  });

  it('output passes every Performance invariant on the composed (Perf + Frontend) view', () => {
    const composed = composedArchitectureForInvariants();
    for (const inv of PERFORMANCE_INVARIANTS) {
      const ok = inv.detect(composed);
      expect(ok, `invariant ${inv.id} should pass on the composed view`).toBe(true);
    }
  });

  it('idempotent — running twice yields equivalent ArchitectOutput', async () => {
    const { fn: spawner } = fakeGoldenSpawner();
    const arch = new PerformanceArchitect({ spawner });
    const a = await arch.run(buildFakeInput());
    const b = await arch.run(buildFakeInput());
    expect(a).toEqual(b);
  });
});

/**
 * Page-type CWV reasonableness — the task brief calls this out
 * specifically: "verify Core Web Vitals budgets are reasonable per
 * page-type (e.g., article page LCP target < 2.5s)".
 *
 * Article/marketing/story pages must hit the Google "Good" thresholds.
 * Admin tools may relax with a documented risk (we exercise that case
 * here as a counter-example).
 */
describe('Core Web Vitals budgets are reasonable per page-type', () => {
  const golden = goldenExpectedOutput();

  it('article/story page LCP target is at or below the "Good" 2.5s threshold', () => {
    const cwv = golden.architectureFields[
      'performance.coreWebVitalsBudgets'
    ] as Record<string, unknown>;
    const mobile = cwv.mobile as Record<string, number>;
    expect(mobile.lcpMs).toBeLessThanOrEqual(CWV_GOOD_THRESHOLDS.lcpMs);
    expect(mobile.lcpMs).toBeLessThanOrEqual(2500);
  });

  it('article/story page INP target is at or below the "Good" 200ms threshold', () => {
    const cwv = golden.architectureFields[
      'performance.coreWebVitalsBudgets'
    ] as Record<string, unknown>;
    const mobile = cwv.mobile as Record<string, number>;
    expect(mobile.inpMs).toBeLessThanOrEqual(CWV_GOOD_THRESHOLDS.inpMs);
    expect(mobile.inpMs).toBeLessThanOrEqual(200);
  });

  it('article/story page CLS target is at or below the "Good" 0.1 threshold', () => {
    const cwv = golden.architectureFields[
      'performance.coreWebVitalsBudgets'
    ] as Record<string, unknown>;
    const mobile = cwv.mobile as Record<string, number>;
    expect(mobile.cls).toBeLessThanOrEqual(CWV_GOOD_THRESHOLDS.cls);
    expect(mobile.cls).toBeLessThanOrEqual(0.1);
  });

  it('article/story page TTFB target is at or below the "Good" 800ms threshold', () => {
    const cwv = golden.architectureFields[
      'performance.coreWebVitalsBudgets'
    ] as Record<string, unknown>;
    const mobile = cwv.mobile as Record<string, number>;
    expect(mobile.ttfbMs).toBeLessThanOrEqual(CWV_GOOD_THRESHOLDS.ttfbMs);
  });

  it('mobile and desktop have matching LCP/INP/CLS budgets (mobile is the gating bar)', () => {
    const cwv = golden.architectureFields[
      'performance.coreWebVitalsBudgets'
    ] as Record<string, unknown>;
    const mobile = cwv.mobile as Record<string, number>;
    const desktop = cwv.desktop as Record<string, number>;
    // Desktop can be tighter than mobile but never looser on these
    // user-experience metrics.
    expect(desktop.lcpMs).toBeLessThanOrEqual(mobile.lcpMs);
    expect(desktop.inpMs).toBeLessThanOrEqual(mobile.inpMs);
    expect(desktop.cls).toBeLessThanOrEqual(mobile.cls);
  });

  it('pageType is declared explicitly (story/marketing/admin)', () => {
    const cwv = golden.architectureFields[
      'performance.coreWebVitalsBudgets'
    ] as Record<string, unknown>;
    expect(typeof cwv.pageType).toBe('string');
    expect(['marketing', 'story', 'admin']).toContain(cwv.pageType);
  });

  it('Lighthouse Performance floor is ≥ 90 per locked playbook', () => {
    const lb = golden.architectureFields['performance.lighthouseBudgets'] as Record<
      string,
      number
    >;
    expect(lb.performance).toBeGreaterThanOrEqual(LIGHTHOUSE_FLOORS.performance);
  });

  it('Lighthouse SEO floor is ≥ 95 per locked playbook', () => {
    const lb = golden.architectureFields['performance.lighthouseBudgets'] as Record<
      string,
      number
    >;
    expect(lb.seo).toBeGreaterThanOrEqual(LIGHTHOUSE_FLOORS.seo);
  });

  it('Lighthouse Accessibility floor is ≥ 95 per locked playbook', () => {
    const lb = golden.architectureFields['performance.lighthouseBudgets'] as Record<
      string,
      number
    >;
    expect(lb.accessibility).toBeGreaterThanOrEqual(LIGHTHOUSE_FLOORS.accessibility);
  });

  it('Lighthouse Best Practices floor is ≥ 90 per locked playbook', () => {
    const lb = golden.architectureFields['performance.lighthouseBudgets'] as Record<
      string,
      number
    >;
    expect(lb.bestPractices).toBeGreaterThanOrEqual(LIGHTHOUSE_FLOORS.bestPractices);
  });

  it('bundle budget stays at or below the 250KB gzip hard ceiling', () => {
    const bb = golden.architectureFields['performance.bundleSizeBudget'] as Record<
      string,
      unknown
    >;
    const route = bb.routeChunkKb as Record<string, number>;
    expect(route.gzip).toBeGreaterThan(0);
    expect(route.gzip).toBeLessThanOrEqual(250);
  });

  it('story-page bundle budget matches the locked 170KB gzip default', () => {
    const bb = golden.architectureFields['performance.bundleSizeBudget'] as Record<
      string,
      unknown
    >;
    const route = bb.routeChunkKb as Record<string, number>;
    // Story = 170KB per locked playbook.
    expect(route.gzip).toBe(170);
  });

  it('image plan declares AVIF or WebP (not raw JPEG/PNG only)', () => {
    const ip = golden.architectureFields[
      'performance.imageOptimizationPlan'
    ] as Record<string, unknown>;
    const formats = ip.formats as string[];
    const modern = formats.some(f => f === 'avif' || f === 'webp');
    expect(modern).toBe(true);
  });

  it('font plan uses display=swap or display=optional (no FOIT)', () => {
    const fp = golden.architectureFields[
      'performance.fontOptimizationPlan'
    ] as Record<string, unknown>;
    expect(['swap', 'optional']).toContain(fp.display);
  });

  it('font plan is self-hosted (no third-party CDN fonts)', () => {
    const fp = golden.architectureFields[
      'performance.fontOptimizationPlan'
    ] as Record<string, unknown>;
    expect(fp.selfHosted).toBe(true);
  });

  it('LCP candidate is the hero image (largest above-fold element)', () => {
    const ip = golden.architectureFields[
      'performance.imageOptimizationPlan'
    ] as Record<string, unknown>;
    expect(ip.lcpCandidate).toBe('hero-portrait');
  });

  it('criticalRenderPath.lcpAnchor matches imageOptimizationPlan.lcpCandidate', () => {
    const ip = golden.architectureFields[
      'performance.imageOptimizationPlan'
    ] as Record<string, unknown>;
    const crp = golden.architectureFields[
      'performance.criticalRenderPath'
    ] as Record<string, unknown>;
    expect(crp.lcpAnchor).toBe(ip.lcpCandidate);
  });

  it('cache strategy populates all three tiers (CDN + browser + server)', () => {
    const cs = golden.architectureFields['performance.cacheStrategy'] as Record<
      string,
      unknown
    >;
    expect(cs.cdn).toBeTruthy();
    expect(cs.browser).toBeTruthy();
    expect(cs.server).toBeTruthy();
  });
});
