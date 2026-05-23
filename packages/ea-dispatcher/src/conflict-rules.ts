/**
 * @caia/ea-dispatcher — semantic-conflict detection.
 *
 * Sourced from research/17_architect_framework_spec_2026.md §5.2.
 *
 * Field-level conflicts are impossible by construction (disjoint-key
 * SectionContracts). Semantic conflicts — same operator intent expressed
 * differently by different architects — are detected here by a fixed set
 * of predicates after composition.
 *
 * Rules fire on the composed architecture blob (the disjoint-key union).
 * Each rule names the two architects whose fields are in tension and the
 * field paths involved. Conflict resolution is then a precedence-ladder
 * lookup (see precedence-resolver.ts); the loser's field gets a `_dissent`
 * annotation, the winner's is untouched.
 */

import type { ArchitectName } from '@caia/architect-kit';

export interface SemanticConflictRule {
  /** Stable identifier surfaced in dissent annotations and dashboard. */
  id: string;
  /** Short human-readable description for logs + operator UI. */
  description: string;
  /**
   * The two architects whose fields the rule reconciles. Order doesn't
   * matter — precedence is looked up at resolution time.
   */
  architects: readonly [ArchitectName, ArchitectName];
  /** Field paths touched (for dissent annotation + dashboard rendering). */
  fields: readonly string[];
  /**
   * Pure predicate over the composed architecture. Returns true iff the
   * rule fires (there IS a conflict to resolve).
   */
  detect: (composed: Record<string, unknown>) => boolean;
}

/**
 * Helper — read a dotted-path value from an object. Returns `undefined` if
 * any intermediate segment is missing. Used by rule predicates.
 */
export function getPath(obj: Record<string, unknown>, path: string): unknown {
  // Composed architecture uses FLAT dotted keys (matching the SectionContract
  // path convention). So we first try the flat lookup; if absent, fall back
  // to nested.
  if (path in obj) return obj[path];
  const segs = path.split('.');
  let cur: unknown = obj;
  for (const seg of segs) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function asArray<T = unknown>(v: unknown): readonly T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

// ─── Rule registry ────────────────────────────────────────────────────────

/**
 * The canonical semantic-conflict rule set. ~12 rules per spec §5.2 cover
 * the known overlap zones between architects. Each rule is a small pure
 * predicate so the dispatcher can run them all in <1ms.
 */
export const SEMANTIC_CONFLICT_RULES: readonly SemanticConflictRule[] = [
  {
    id: 'image-lazy-vs-preload',
    description: 'SEO preloads an image that Performance wants lazy-loaded.',
    architects: ['seo', 'performance'],
    fields: ['performance.lazyLoadList', 'seo.preloadHints'],
    detect: (c) => {
      const lazy = asArray<{ src: string }>(getPath(c, 'performance.lazyLoadList'))
        .map((x) => x.src);
      const preload = asArray<{ href: string }>(getPath(c, 'seo.preloadHints'))
        .map((x) => x.href);
      return preload.some((href) => lazy.includes(href));
    },
  },
  {
    id: 'csp-frame-vs-iframe-embed',
    description: 'Security CSP forbids iframes; Frontend includes an iframe-embed widget.',
    architects: ['security', 'frontend'],
    fields: ['security.cspPolicy', 'frontend.componentTree'],
    detect: (c) => {
      const csp = getPath(c, 'security.cspPolicy');
      const frameSrc = isObject(csp) ? (csp['frameSrc'] as unknown) : undefined;
      const tree = asArray<{ kind?: string }>(getPath(c, 'frontend.componentTree'));
      const hasIframe = tree.some((node) => node?.kind === 'iframe-embed');
      return frameSrc === "'none'" && hasIframe;
    },
  },
  {
    id: 'analytics-event-without-observability-metric',
    description:
      'Analytics tracks an event that has no corresponding Observability metrics export.',
    architects: ['analytics', 'observability'],
    fields: ['analytics.eventTaxonomy', 'observability.metricsExport'],
    detect: (c) => {
      const events = asArray<{ name?: string }>(getPath(c, 'analytics.eventTaxonomy'));
      const metrics = asArray<{ event?: string }>(getPath(c, 'observability.metricsExport'));
      const metricEvents = new Set(metrics.map((m) => m.event).filter(Boolean));
      return events.some((e) => e.name && !metricEvents.has(e.name));
    },
  },
  {
    id: 'endpoint-without-gateway-ratelimit',
    description: 'Backend exposes an endpoint not covered by an apiGateway rate limit.',
    architects: ['backend', 'apiGateway'],
    fields: ['backend.endpointEnumeration', 'apiGateway.rateLimit'],
    detect: (c) => {
      const endpoints = asArray<{ path?: string }>(
        getPath(c, 'backend.endpointEnumeration'),
      ).map((e) => e.path).filter(Boolean) as string[];
      const limits = asArray<{ path?: string }>(getPath(c, 'apiGateway.rateLimit'))
        .map((l) => l.path).filter(Boolean) as string[];
      return endpoints.some((e) => !limits.includes(e));
    },
  },
  {
    id: 'interactive-widget-without-keyboard-spec',
    description:
      'Frontend ships an interactive widget without an A11y keyboard spec.',
    architects: ['frontend', 'a11y'],
    fields: ['frontend.componentTree', 'a11y.keyboardSpec'],
    detect: (c) => {
      const tree = asArray<{ id?: string; kind?: string; interactive?: boolean }>(
        getPath(c, 'frontend.componentTree'),
      );
      const interactive = tree
        .filter((n) => n.interactive)
        .map((n) => n.id)
        .filter(Boolean) as string[];
      const keys = asArray<{ componentId?: string }>(getPath(c, 'a11y.keyboardSpec'))
        .map((k) => k.componentId).filter(Boolean) as string[];
      return interactive.some((id) => !keys.includes(id));
    },
  },
  {
    id: 'flag-without-killswitch',
    description: 'Feature flag defined without a kill-switch path.',
    architects: ['featureFlagging', 'security'],
    fields: ['featureFlags.flagStore', 'featureFlags.killSwitch'],
    detect: (c) => {
      const flags = asArray<{ name?: string }>(getPath(c, 'featureFlags.flagStore'));
      const switches = asArray<{ name?: string }>(getPath(c, 'featureFlags.killSwitch'))
        .map((s) => s.name);
      return flags.some((f) => f.name && !switches.includes(f.name));
    },
  },
  {
    id: 'ab-test-without-flag-binding',
    description: 'A/B Testing variant has no Feature Flag binding.',
    architects: ['abTesting', 'featureFlagging'],
    fields: ['abTesting.variantRouter', 'featureFlags.flagStore'],
    detect: (c) => {
      const variants = asArray<{ flag?: string }>(getPath(c, 'abTesting.variantRouter'));
      const flagNames = new Set(
        asArray<{ name?: string }>(getPath(c, 'featureFlags.flagStore'))
          .map((f) => f.name)
          .filter(Boolean),
      );
      return variants.some((v) => !v.flag || !flagNames.has(v.flag));
    },
  },
  {
    id: 'image-policy-vs-seo-og-image',
    description:
      'SEO OG image violates the Performance image policy (e.g. > size budget).',
    architects: ['seo', 'performance'],
    fields: ['seo.ogImage', 'performance.imagePolicy'],
    detect: (c) => {
      const og = getPath(c, 'seo.ogImage');
      const policy = getPath(c, 'performance.imagePolicy');
      if (!isObject(og) || !isObject(policy)) return false;
      const maxKb = typeof policy['maxKb'] === 'number' ? (policy['maxKb'] as number) : Infinity;
      const sizeKb = typeof og['sizeKb'] === 'number' ? (og['sizeKb'] as number) : 0;
      return sizeKb > maxKb;
    },
  },
  {
    id: 'consent-vs-analytics-default',
    description:
      'Analytics consent mode is permissive but Security data-classification requires deny-by-default.',
    architects: ['analytics', 'security'],
    fields: ['analytics.consentMode', 'security.dataClassification'],
    detect: (c) => {
      const consent = getPath(c, 'analytics.consentMode');
      const cls = getPath(c, 'security.dataClassification');
      const requiresStrict = cls === 'PII' || cls === 'confidential';
      return requiresStrict && consent !== 'deny-by-default';
    },
  },
  {
    id: 'deploy-without-rollback',
    description: 'DevOps blue-green deploy without a Time Machine revert command.',
    architects: ['devops', 'timeMachine'],
    fields: ['devops.deployStrategy', 'timeMachine.revertCommand'],
    detect: (c) => {
      const deploy = getPath(c, 'devops.deployStrategy');
      const revert = getPath(c, 'timeMachine.revertCommand');
      return deploy === 'blue-green' && (revert == null || revert === '');
    },
  },
  {
    id: 'frontend-tokens-vs-design-anchors',
    description:
      'Frontend uses tokens that contradict the Atlas anchor metadata (mismatch on breakpoints).',
    architects: ['frontend', 'frontend'], // intra-section but spec rule (frontend-only)
    fields: ['frontend.tokens', 'frontend.breakpoints'],
    detect: (c) => {
      const tokens = getPath(c, 'frontend.tokens');
      const breakpoints = getPath(c, 'frontend.breakpoints');
      if (!isObject(tokens) || !isObject(breakpoints)) return false;
      const tokenBp = tokens['breakpoints'];
      const bpList = isObject(breakpoints) ? Object.keys(breakpoints) : [];
      if (!Array.isArray(tokenBp)) return false;
      return tokenBp.some((b) => !bpList.includes(String(b)));
    },
  },
  {
    id: 'testing-without-fixtures-for-endpoint',
    description: 'Testing strategy references endpoints with no fixtures declared.',
    architects: ['testing', 'backend'],
    fields: ['testing.fixtures', 'backend.endpointEnumeration'],
    detect: (c) => {
      const endpoints = asArray<{ path?: string }>(
        getPath(c, 'backend.endpointEnumeration'),
      ).map((e) => e.path).filter(Boolean) as string[];
      const fixtures = asArray<{ path?: string }>(getPath(c, 'testing.fixtures'))
        .map((f) => f.path).filter(Boolean) as string[];
      // A simple heuristic — at least one endpoint must have a fixture.
      if (endpoints.length === 0) return false;
      return !endpoints.some((e) => fixtures.includes(e));
    },
  },
];

// ─── Detection runner ─────────────────────────────────────────────────────

export interface FiredRule {
  rule: SemanticConflictRule;
}

/**
 * Run every rule over the composed blob. Returns the set of rules that fired.
 * Order matches `SEMANTIC_CONFLICT_RULES` (so logs are stable).
 */
export function detectConflicts(
  composed: Record<string, unknown>,
  rules: readonly SemanticConflictRule[] = SEMANTIC_CONFLICT_RULES,
): readonly FiredRule[] {
  const fired: FiredRule[] = [];
  for (const rule of rules) {
    try {
      if (rule.detect(composed)) fired.push({ rule });
    } catch {
      // A buggy rule predicate is non-fatal — record nothing, move on.
    }
  }
  return fired;
}
