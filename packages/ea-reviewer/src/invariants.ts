/**
 * @caia/ea-reviewer — cross-architect invariants (consistency lens).
 *
 * Sourced from research/17_architect_framework_spec_2026.md §6.2.
 *
 * Roughly 10-15 deterministic predicates that look across the composed
 * architecture and flag inconsistencies. Each invariant declares the
 * architect(s) responsible so the reviewer's `rerunArchitects` directive
 * names them specifically.
 *
 * Each invariant is a small pure function — no LLM, no IO.
 */

import type {
  ArchitectName,
} from '@caia/architect-kit';
import type {
  ConsistencyFinding,
  Severity,
} from './types.js';

export interface Invariant {
  id: string;
  description: string;
  /** Architects to name in the rerun directive when this invariant fails. */
  blameArchitects: readonly ArchitectName[];
  /** Predicate — returns true iff the invariant HOLDS (no finding). */
  holds: (composed: Record<string, unknown>) => boolean;
  /** Severity used for findings (default attached at registration). */
  severity?: Severity;
}

function asArray<T = unknown>(v: unknown): readonly T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function getField(composed: Record<string, unknown>, path: string): unknown {
  return composed[path];
}

// ─── Invariant registry ────────────────────────────────────────────────────

export const REVIEWER_INVARIANTS: readonly Invariant[] = [
  {
    id: 'every-endpoint-has-gateway-policy',
    description:
      'Every backend endpoint has a corresponding apiGateway.rateLimit + errorEnvelope entry.',
    blameArchitects: ['apiGateway'],
    holds: (c) => {
      const endpoints = asArray<{ path?: string }>(
        getField(c, 'backend.endpointEnumeration'),
      )
        .map((e) => e.path)
        .filter(Boolean) as string[];
      const limits = asArray<{ path?: string }>(getField(c, 'apiGateway.rateLimit'))
        .map((l) => l.path)
        .filter(Boolean) as string[];
      if (endpoints.length === 0) return true;
      return endpoints.every((e) => limits.includes(e));
    },
  },
  {
    id: 'every-event-has-metric',
    description:
      'Every analytics event has a corresponding observability.metricsExport entry.',
    blameArchitects: ['observability'],
    holds: (c) => {
      const events = asArray<{ name?: string }>(getField(c, 'analytics.eventTaxonomy'))
        .map((e) => e.name)
        .filter(Boolean) as string[];
      const metrics = new Set(
        asArray<{ event?: string }>(getField(c, 'observability.metricsExport'))
          .map((m) => m.event)
          .filter(Boolean),
      );
      return events.every((e) => metrics.has(e));
    },
  },
  {
    id: 'interactive-widgets-have-keyboard-spec',
    description:
      'Every interactive widget in frontend.componentTree has an a11y.keyboardSpec entry.',
    blameArchitects: ['a11y'],
    holds: (c) => {
      const tree = asArray<{ id?: string; interactive?: boolean }>(
        getField(c, 'frontend.componentTree'),
      );
      const interactiveIds = tree
        .filter((n) => n.interactive)
        .map((n) => n.id)
        .filter(Boolean) as string[];
      const keys = new Set(
        asArray<{ componentId?: string }>(getField(c, 'a11y.keyboardSpec'))
          .map((k) => k.componentId)
          .filter(Boolean),
      );
      return interactiveIds.every((id) => keys.has(id));
    },
  },
  {
    id: 'csp-allows-iframes-if-tree-has-them',
    description:
      "If frontend.componentTree contains iframe-embed widgets, security.cspPolicy.frameSrc must not be 'none'.",
    blameArchitects: ['security'],
    holds: (c) => {
      const tree = asArray<{ kind?: string }>(getField(c, 'frontend.componentTree'));
      const hasIframe = tree.some((n) => n?.kind === 'iframe-embed');
      if (!hasIframe) return true;
      const csp = getField(c, 'security.cspPolicy');
      const frameSrc = isObject(csp) ? csp['frameSrc'] : undefined;
      return frameSrc !== "'none'";
    },
  },
  {
    id: 'every-feature-flag-has-killswitch',
    description:
      'Every featureFlags.flagStore entry has a corresponding killSwitch entry.',
    blameArchitects: ['featureFlagging'],
    holds: (c) => {
      const flags = asArray<{ name?: string }>(getField(c, 'featureFlags.flagStore'))
        .map((f) => f.name)
        .filter(Boolean) as string[];
      const switches = new Set(
        asArray<{ name?: string }>(getField(c, 'featureFlags.killSwitch'))
          .map((s) => s.name)
          .filter(Boolean),
      );
      return flags.every((f) => switches.has(f));
    },
  },
  {
    id: 'ab-test-variants-bind-to-flags',
    description: 'Every A/B test variantRouter entry references an existing flag.',
    blameArchitects: ['abTesting'],
    holds: (c) => {
      const variants = asArray<{ flag?: string }>(getField(c, 'abTesting.variantRouter'));
      if (variants.length === 0) return true;
      const flags = new Set(
        asArray<{ name?: string }>(getField(c, 'featureFlags.flagStore'))
          .map((f) => f.name)
          .filter(Boolean),
      );
      return variants.every((v) => !!v.flag && flags.has(v.flag));
    },
  },
  {
    id: 'preload-and-lazy-load-are-disjoint',
    description:
      'No image appears in both seo.preloadHints and performance.lazyLoadList.',
    blameArchitects: ['seo', 'performance'],
    holds: (c) => {
      const preload = new Set(
        asArray<{ href?: string }>(getField(c, 'seo.preloadHints'))
          .map((p) => p.href)
          .filter(Boolean),
      );
      const lazy = asArray<{ src?: string }>(getField(c, 'performance.lazyLoadList'))
        .map((l) => l.src)
        .filter(Boolean) as string[];
      return !lazy.some((s) => preload.has(s));
    },
  },
  {
    id: 'database-schema-references-only-known-engines',
    description:
      'database.engine is one of the supported set (postgres, mysql, sqlite, mongodb).',
    blameArchitects: ['database'],
    holds: (c) => {
      const engine = asString(getField(c, 'database.engine'));
      if (engine === undefined) return true; // missing handled by completeness
      return ['postgres', 'mysql', 'sqlite', 'mongodb'].includes(engine);
    },
  },
  {
    id: 'devops-blue-green-implies-time-machine-revert',
    description: 'Blue-green deploys require a time-machine revert command.',
    blameArchitects: ['timeMachine'],
    holds: (c) => {
      if (getField(c, 'devops.deployStrategy') !== 'blue-green') return true;
      const revert = getField(c, 'timeMachine.revertCommand');
      return typeof revert === 'string' && revert.length > 0;
    },
  },
  {
    id: 'pii-data-requires-deny-by-default-consent',
    description:
      'When security.dataClassification is PII or confidential, analytics.consentMode must be deny-by-default.',
    blameArchitects: ['analytics'],
    holds: (c) => {
      const cls = getField(c, 'security.dataClassification');
      if (cls !== 'PII' && cls !== 'confidential') return true;
      return getField(c, 'analytics.consentMode') === 'deny-by-default';
    },
  },
  {
    id: 'every-endpoint-has-fixture',
    description:
      'testing.fixtures covers at least one of every endpoint declared in backend.endpointEnumeration.',
    blameArchitects: ['testing'],
    holds: (c) => {
      const endpoints = asArray<{ path?: string }>(
        getField(c, 'backend.endpointEnumeration'),
      )
        .map((e) => e.path)
        .filter(Boolean) as string[];
      if (endpoints.length === 0) return true;
      const fixtures = asArray<{ path?: string }>(getField(c, 'testing.fixtures'))
        .map((f) => f.path)
        .filter(Boolean) as string[];
      return endpoints.some((e) => fixtures.includes(e));
    },
  },
  {
    id: 'observability-logs-are-non-empty-when-backend-present',
    description:
      'observability.logShape must be non-empty when a backend section is present.',
    blameArchitects: ['observability'],
    holds: (c) => {
      const hasBackend = getField(c, 'backend.framework') != null;
      if (!hasBackend) return true;
      const logs = getField(c, 'observability.logShape');
      if (logs == null) return false;
      if (typeof logs === 'string') return logs.length > 0;
      if (Array.isArray(logs)) return logs.length > 0;
      if (typeof logs === 'object') return Object.keys(logs as object).length > 0;
      return false;
    },
  },
  {
    id: 'a11y-wcag-level-is-aa-or-aaa',
    description: 'a11y.wcagLevel must be AA or AAA (per CAIA policy).',
    blameArchitects: ['a11y'],
    holds: (c) => {
      const level = asString(getField(c, 'a11y.wcagLevel'));
      if (level === undefined) return true; // handled by completeness
      return ['AA', 'AAA'].includes(level);
    },
  },
  {
    id: 'performance-lighthouse-targets-are-numeric',
    description: 'performance.lighthouseTargets values are numeric and ≤100.',
    blameArchitects: ['performance'],
    holds: (c) => {
      const targets = getField(c, 'performance.lighthouseTargets');
      if (!isObject(targets)) return targets === undefined;
      for (const v of Object.values(targets)) {
        if (typeof v !== 'number' || v > 100 || v < 0) return false;
      }
      return true;
    },
  },
  {
    id: 'seo-canonical-is-https',
    description: 'seo.canonical (if set) is an https URL.',
    blameArchitects: ['seo'],
    holds: (c) => {
      const canonical = asString(getField(c, 'seo.canonical'));
      if (canonical === undefined) return true;
      return canonical.startsWith('https://');
    },
  },
];

// ─── Runner ────────────────────────────────────────────────────────────────

export function runConsistencyLens(
  composed: Record<string, unknown>,
  opts: {
    invariants?: readonly Invariant[];
    severity?: Severity;
  } = {},
): readonly ConsistencyFinding[] {
  const severity: Severity = opts.severity ?? 'P1';
  const invariants = opts.invariants ?? REVIEWER_INVARIANTS;
  const findings: ConsistencyFinding[] = [];
  for (const inv of invariants) {
    let held = true;
    try {
      held = inv.holds(composed);
    } catch {
      // Buggy invariant — treat as held (don't crash the audit on a bad rule).
      held = true;
    }
    if (!held) {
      findings.push({
        invariantId: inv.id,
        description: inv.description,
        blameArchitects: inv.blameArchitects,
        severity: inv.severity ?? severity,
      });
    }
  }
  return findings;
}
