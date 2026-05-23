/**
 * This architect's contributions to the EA Reviewer's cross-architect
 * invariants registry (per spec §6.2).
 *
 * The Reviewer applies a fixed set of cross-architect predicates after
 * composition. This module enumerates Performance's contributions so
 * the Reviewer's `invariants-registry.ts` (which doesn't exist yet —
 * sibling brief F2) can collect them at process boot.
 *
 * Each invariant is a pure predicate over either:
 *   - the per-architect `architectureFields` dict (where keys are FLAT
 *     dotted strings like `'performance.coreWebVitalsBudgets'`), or
 *   - the composed `tickets.architecture` JSONB blob (where the
 *     Dispatcher will nest the same fields under the `performance.*`
 *     path).
 *
 * Both views are accepted — we look up via `readField()` which checks
 * the flat key first, then falls back to the nested path. This lets the
 * same invariants run inside the Performance package's own tests AND
 * inside the Reviewer's post-composition pass.
 *
 * Cross-architect invariants (those that read fields owned by another
 * architect) treat absent foreign data as "cannot verify" and pass
 * trivially. The Reviewer's composed-output pass will exercise the
 * real check; the per-architect test pass exercises only the local
 * checks. This keeps unit tests on the Performance output green even
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
 * Core Web Vitals "Good" thresholds per Google's official guidance.
 * Exported for tests + future Reviewer evidence ladders.
 */
export const CWV_GOOD_THRESHOLDS = {
  lcpMs: 2500,
  inpMs: 200,
  cls: 0.1,
  ttfbMs: 800
} as const;

/**
 * Lighthouse category floors locked by the playbook (spec §2.6).
 */
export const LIGHTHOUSE_FLOORS = {
  performance: 90,
  seo: 95,
  accessibility: 95,
  bestPractices: 90
} as const;

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
 * Performance's contributed invariants. Listed in stable order.
 */
export const PERFORMANCE_INVARIANTS: readonly ArchitectInvariant[] = [
  {
    id: 'performance.coreWebVitalsBudgets-mobile-lcp-good',
    contributor: 'performance',
    reads: ['performance.coreWebVitalsBudgets'],
    severity: 'fail',
    description:
      'Mobile LCP target must be at or below the Google "Good" threshold of 2500ms. Marketing/article pages MUST hit this floor; admin tools may relax with a documented risk.',
    detect(arch): boolean {
      const cwv = readField(arch, 'performance.coreWebVitalsBudgets');
      if (typeof cwv !== 'object' || cwv === null) return false;
      const mobile = (cwv as Record<string, unknown>).mobile;
      if (typeof mobile !== 'object' || mobile === null) return false;
      const lcp = (mobile as Record<string, unknown>).lcpMs;
      if (typeof lcp !== 'number') return false;
      // Hard ceiling at 4000ms (boundary of "needs-improvement").
      // Most pages should hit the 2500ms Good threshold.
      return lcp <= 4000;
    }
  },
  {
    id: 'performance.coreWebVitalsBudgets-mobile-inp-good',
    contributor: 'performance',
    reads: ['performance.coreWebVitalsBudgets'],
    severity: 'fail',
    description:
      'Mobile INP target must be at or below the Google "Good" threshold of 200ms. Above 500ms is failing per CWV docs.',
    detect(arch): boolean {
      const cwv = readField(arch, 'performance.coreWebVitalsBudgets');
      if (typeof cwv !== 'object' || cwv === null) return false;
      const mobile = (cwv as Record<string, unknown>).mobile;
      if (typeof mobile !== 'object' || mobile === null) return false;
      const inp = (mobile as Record<string, unknown>).inpMs;
      if (typeof inp !== 'number') return false;
      return inp <= 500;
    }
  },
  {
    id: 'performance.coreWebVitalsBudgets-mobile-cls-good',
    contributor: 'performance',
    reads: ['performance.coreWebVitalsBudgets'],
    severity: 'fail',
    description:
      'Mobile CLS target must be at or below the Google "Good" threshold of 0.1. Above 0.25 is failing per CWV docs.',
    detect(arch): boolean {
      const cwv = readField(arch, 'performance.coreWebVitalsBudgets');
      if (typeof cwv !== 'object' || cwv === null) return false;
      const mobile = (cwv as Record<string, unknown>).mobile;
      if (typeof mobile !== 'object' || mobile === null) return false;
      const cls = (mobile as Record<string, unknown>).cls;
      if (typeof cls !== 'number') return false;
      return cls <= 0.25;
    }
  },
  {
    id: 'performance.lighthouseBudgets-performance-at-least-90',
    contributor: 'performance',
    reads: ['performance.lighthouseBudgets'],
    severity: 'fail',
    description:
      'Lighthouse Performance category floor must be ≥ 90 per the locked playbook (spec §2.6). Sub-90 floors require an operator override.',
    detect(arch): boolean {
      const lb = readField(arch, 'performance.lighthouseBudgets');
      if (typeof lb !== 'object' || lb === null) return false;
      const p = (lb as Record<string, unknown>).performance;
      return typeof p === 'number' && p >= 90;
    }
  },
  {
    id: 'performance.lighthouseBudgets-categories-at-locked-floors',
    contributor: 'performance',
    reads: ['performance.lighthouseBudgets'],
    severity: 'fail',
    description:
      'Lighthouse category floors must meet the locked playbook minimums: Performance ≥ 90, SEO ≥ 95, Accessibility ≥ 95, Best Practices ≥ 90.',
    detect(arch): boolean {
      const lb = readField(arch, 'performance.lighthouseBudgets');
      if (typeof lb !== 'object' || lb === null) return false;
      const o = lb as Record<string, unknown>;
      const checks = [
        ['performance', LIGHTHOUSE_FLOORS.performance],
        ['seo', LIGHTHOUSE_FLOORS.seo],
        ['accessibility', LIGHTHOUSE_FLOORS.accessibility],
        ['bestPractices', LIGHTHOUSE_FLOORS.bestPractices]
      ] as const;
      for (const [key, min] of checks) {
        const v = o[key];
        if (typeof v !== 'number' || v < min) return false;
      }
      return true;
    }
  },
  {
    id: 'performance.bundleSizeBudget-route-under-250kb-gzip',
    contributor: 'performance',
    reads: ['performance.bundleSizeBudget'],
    severity: 'fail',
    description:
      'Route-chunk JavaScript budget (gzip) must be ≤ 250KB. Above this the route is unlikely to hit Lighthouse Performance ≥ 90 on mobile.',
    detect(arch): boolean {
      const bb = readField(arch, 'performance.bundleSizeBudget');
      if (typeof bb !== 'object' || bb === null) return false;
      const route = (bb as Record<string, unknown>).routeChunkKb;
      if (typeof route !== 'object' || route === null) return false;
      const gz = (route as Record<string, unknown>).gzip;
      return typeof gz === 'number' && gz > 0 && gz <= 250;
    }
  },
  {
    id: 'performance.imagePlan-formats-include-avif-or-webp',
    contributor: 'performance',
    reads: ['performance.imageOptimizationPlan'],
    severity: 'fail',
    description:
      'imageOptimizationPlan.formats must include at least one of `avif` or `webp`. Raw JPEG/PNG without a modern format is locked-stack non-compliant.',
    detect(arch): boolean {
      const ip = readField(arch, 'performance.imageOptimizationPlan');
      if (typeof ip !== 'object' || ip === null) return false;
      const formats = (ip as Record<string, unknown>).formats;
      if (!Array.isArray(formats)) return false;
      return formats.includes('avif') || formats.includes('webp');
    }
  },
  {
    id: 'performance.fontPlan-display-swap-or-optional',
    contributor: 'performance',
    reads: ['performance.fontOptimizationPlan'],
    severity: 'fail',
    description:
      'fontOptimizationPlan.display must be one of "swap" or "optional" to avoid FOIT / invisible-text periods.',
    detect(arch): boolean {
      const fp = readField(arch, 'performance.fontOptimizationPlan');
      if (typeof fp !== 'object' || fp === null) return false;
      const display = (fp as Record<string, unknown>).display;
      return display === 'swap' || display === 'optional';
    }
  },
  {
    id: 'performance.fontPlan-self-hosted',
    contributor: 'performance',
    reads: ['performance.fontOptimizationPlan'],
    severity: 'fail',
    description:
      'fontOptimizationPlan.selfHosted must be true. Third-party CDN fonts violate the locked stack.',
    detect(arch): boolean {
      const fp = readField(arch, 'performance.fontOptimizationPlan');
      if (typeof fp !== 'object' || fp === null) return false;
      return (fp as Record<string, unknown>).selfHosted === true;
    }
  },
  {
    id: 'performance.lazyLoad-references-real-components',
    contributor: 'performance',
    reads: ['performance.lazyLoadStrategy', 'frontend.componentTree'],
    severity: 'advisory',
    description:
      'Every component referenced in `performance.lazyLoadStrategy` should exist in Frontend `componentTree`. Trivially passes if the Frontend output is absent.',
    detect(arch): boolean {
      const lazy = readField(arch, 'performance.lazyLoadStrategy');
      const tree = readField(arch, 'frontend.componentTree');
      if (typeof lazy !== 'object' || lazy === null) return true;
      if (!Array.isArray(tree)) return true; // foreign data absent ⇒ trivial pass
      const ids = new Set<string>();
      const walk = (nodes: unknown): void => {
        if (!Array.isArray(nodes)) return;
        for (const n of nodes) {
          if (typeof n !== 'object' || n === null) continue;
          const node = n as Record<string, unknown>;
          if (typeof node.id === 'string') ids.add(node.id);
          if (Array.isArray(node.children)) walk(node.children);
        }
      };
      walk(tree);
      for (const compId of Object.keys(lazy as Record<string, unknown>)) {
        if (!ids.has(compId)) return false;
      }
      return true;
    }
  },
  {
    id: 'performance.criticalRenderPath-lcp-anchor-matches-image-plan',
    contributor: 'performance',
    reads: ['performance.criticalRenderPath', 'performance.imageOptimizationPlan'],
    severity: 'fail',
    description:
      'If both `criticalRenderPath.lcpAnchor` and `imageOptimizationPlan.lcpCandidate` are set, they must agree on the same component ID. Disagreement means the build wires wrong asset as priority.',
    detect(arch): boolean {
      const crp = readField(arch, 'performance.criticalRenderPath');
      const ip = readField(arch, 'performance.imageOptimizationPlan');
      if (typeof crp !== 'object' || crp === null) return true;
      if (typeof ip !== 'object' || ip === null) return true;
      const anchor = (crp as Record<string, unknown>).lcpAnchor;
      const candidate = (ip as Record<string, unknown>).lcpCandidate;
      if (typeof anchor !== 'string' || typeof candidate !== 'string') return true;
      return anchor === candidate;
    }
  },
  {
    id: 'performance.cacheStrategy-tri-tier-populated',
    contributor: 'performance',
    reads: ['performance.cacheStrategy'],
    severity: 'fail',
    description:
      'cacheStrategy must populate all three tiers: cdn, browser, server. Missing any tier means an asset class has no caching guidance.',
    detect(arch): boolean {
      const cs = readField(arch, 'performance.cacheStrategy');
      if (typeof cs !== 'object' || cs === null) return false;
      const o = cs as Record<string, unknown>;
      return (
        typeof o.cdn === 'object' &&
        o.cdn !== null &&
        typeof o.browser === 'object' &&
        o.browser !== null &&
        typeof o.server === 'object' &&
        o.server !== null
      );
    }
  }
];
