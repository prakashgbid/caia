/**
 * `PerformanceArchitectContract` — the canonical owned-fields declaration
 * for architect #6 of CAIA's 17-architect EA fan-out.
 *
 * Sources of truth:
 *   - spec §1.3 (ArchitectSectionContract + architectMeta)
 *   - spec §2.6 (Performance Architect owns `performance.*`)
 *   - task brief (coreWebVitalsBudgets, bundleSizeBudget,
 *     imageOptimizationPlan, fontOptimizationPlan, lazyLoadStrategy,
 *     cacheStrategy, criticalRenderPath, lighthouseBudgets)
 *
 * Field disjointness with the other 16 architects is the invariant the
 * Dispatcher enforces. All chosen keys live under the `performance.*`
 * namespace and do not collide with any sibling architect's namespace.
 *
 * Note: the task brief field set replaces the older spec §2.6
 * enumeration (lighthouseTargets, bundleBudget, lcpCandidate, inpBudgetMs,
 * clsBudget, cacheStrategy, imagePolicy, fontPolicy, prefetchHints,
 * preloadHints). The brief's `coreWebVitalsBudgets` rolls up the
 * LCP/INP/CLS targets, `bundleSizeBudget` rolls up `bundleBudget` (with
 * gzip thresholds), and `lazyLoadStrategy` rolls up prefetch/preload
 * hints. `criticalRenderPath` is a new sibling concern not in the older
 * spec but listed in the task brief — it documents above-the-fold render
 * priorities (preload, font-display, deferred JS, etc.).
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
export const PERFORMANCE_FIELD_FIX_HINTS: Readonly<Record<string, string>> = {
  'performance.coreWebVitalsBudgets':
    'Per-page-type LCP/INP/CLS targets. Mobile thresholds (the gating bar): LCP <2.5s, INP <200ms, CLS <0.1. Desktop matches mobile. Reject any target that exceeds Google "Good" thresholds without a documented justification under risks.',
  'performance.bundleSizeBudget':
    'Total JavaScript shipped to the route, in gzip. Default 170KB gzipped / route (per spec §2.6). Stricter for marketing pages (130KB), more permissive for admin tools (250KB). Reject values without gzip + brotli figures.',
  'performance.imageOptimizationPlan':
    'next/image config: formats=AVIF→WebP→fallback, 4 size breakpoints, eager-load only for above-fold LCP candidate, sizes attribute per breakpoint. No raw <img> tags for content images.',
  'performance.fontOptimizationPlan':
    'next/font usage: display=swap, preload only the primary face, subset to needed glyphs, self-host (no third-party CDN fonts unless explicitly tenant-overridden). List the variable axes used.',
  'performance.lazyLoadStrategy':
    'Per-component lazy/eager decision. Above-fold = eager. Below-fold images, modals, charts, third-party iframes = lazy with intersection observer. Use next/dynamic for client-only heavy components.',
  'performance.cacheStrategy':
    'Three tiers: cdn (edge), browser (Cache-Control), server (Next.js fetch revalidate). Static assets: 1 year immutable. HTML: short s-maxage with stale-while-revalidate. API data: per-route revalidation window.',
  'performance.criticalRenderPath':
    'Above-the-fold render plan: which resources preload, font-display, render-blocking JS deferred, inline critical CSS. The LCP candidate component is the anchor.',
  'performance.lighthouseBudgets':
    'Lighthouse category floors: Performance ≥90, SEO ≥95, Accessibility ≥95, Best Practices ≥90. The build gate runs lighthouse-ci against these floors. Reject any sub-90 Perf floor without a risk callout.'
};

/**
 * The owned section specs in stable order.
 */
export const PERFORMANCE_OWNED_SECTIONS: readonly ArchitectSectionSpec[] = [
  {
    path: 'performance.coreWebVitalsBudgets',
    description:
      'Per-page-type Core Web Vitals targets — LCP (Largest Contentful Paint), INP (Interaction to Next Paint, replaces FID), CLS (Cumulative Layout Shift), TTFB (Time to First Byte). Mobile and desktop thresholds.',
    required: true
  },
  {
    path: 'performance.bundleSizeBudget',
    description:
      'Per-route JavaScript bundle budget in gzip + brotli bytes. Includes route-level chunk + shared baseline. Page-type-aware defaults (marketing stricter than admin).',
    required: true
  },
  {
    path: 'performance.imageOptimizationPlan',
    description:
      'next/image strategy: format preference (AVIF→WebP→fallback), responsive breakpoints, eager-vs-lazy per anchor, sizes attribute per breakpoint, LCP candidate flagged for priority.',
    required: true
  },
  {
    path: 'performance.fontOptimizationPlan',
    description:
      'next/font configuration: display strategy, preload list, subset coverage, self-hosting policy, variable-axis declarations, FOUT/FOIT mitigation.',
    required: true
  },
  {
    path: 'performance.lazyLoadStrategy',
    description:
      'Per-component lazy/eager loading decisions. next/dynamic boundaries for heavy client components. Intersection-observer thresholds for below-fold media.',
    required: true
  },
  {
    path: 'performance.cacheStrategy',
    description:
      'Three-tier cache plan: CDN (Cloudflare edge cache rules), browser (Cache-Control headers per asset class), server (Next.js fetch revalidation windows). Stale-while-revalidate posture per route.',
    required: true
  },
  {
    path: 'performance.criticalRenderPath',
    description:
      'Above-the-fold render path: preload hints, render-blocking JS deferred via next/script strategy, inline critical CSS slice, LCP candidate identified, layout-shift prevention measures.',
    required: true
  },
  {
    path: 'performance.lighthouseBudgets',
    description:
      'Lighthouse category floors — Performance ≥90, SEO ≥95, Accessibility ≥95, Best Practices ≥90. The build gate runs lighthouse-ci against these floors.',
    required: true
  }
];

/**
 * Flat list of owned field paths. Used by `run()` to validate the
 * subagent's output and by the conformance test suite.
 */
export const PERFORMANCE_OWNED_FIELD_KEYS: readonly string[] =
  PERFORMANCE_OWNED_SECTIONS.map(s => s.path);

// ─── Apply predicate ────────────────────────────────────────────────────────

/**
 * Spec §2.6 — Performance runs on every ticket that produces UI (Page,
 * Widget, Story, Form, List). It does NOT apply to pure Foundation
 * tickets (no UI) or pure backend tickets. Matches Frontend's predicate.
 */
export function performanceArchitectAppliesPredicate(ticket: Ticket): boolean {
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
 * Performance is a wave-2 architect — depends on Frontend's
 * `componentTree` + `tokens` + `framework`. Precedence rank 5 per spec
 * §5.2 (performance in CANONICAL_PRECEDENCE_LADDER) — Lighthouse ≥95
 * gate is a hard build floor, ranks above Frontend (#14) and Backend
 * (#12), below Security (#1), DevOps (#2), A11y (#3), and SEO (#4).
 *
 * Runtime model: Sonnet (per task brief — "calls Claude (Sonnet
 * default)"). The older spec §2.6 anticipated a fully deterministic
 * path; the brief's superset of fields (criticalRenderPath, page-type-
 * aware budgets) requires LLM reasoning over the Frontend componentTree
 * and the page-type taxonomy.
 */
export const PERFORMANCE_ARCHITECT_META: ArchitectMeta = {
  dependsOn: ['frontend'],
  precedenceLevel: 5,
  fanoutPolicy: 'always',
  appliesPredicate: performanceArchitectAppliesPredicate,
  runtimeModel: 'sonnet'
};

// ─── The contract ───────────────────────────────────────────────────────────

export const PerformanceArchitectContract: ArchitectSectionContract = {
  contractId: 'performance-architect.v1',
  architectName: 'performance',
  version: '0.1.0',
  sections: PERFORMANCE_OWNED_SECTIONS,
  architectMeta: PERFORMANCE_ARCHITECT_META
};
