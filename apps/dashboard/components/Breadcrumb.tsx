'use client';

/**
 * Breadcrumb — URL-driven crumb trail (DASH-003).
 *
 * Parses `usePathname()` left-to-right, mapping static segments via the
 * SEGMENT_LABELS table and rendering dynamic segments (anything not in the
 * table) as their raw value, truncated.
 *
 * Spec: caia/docs/dashboard-url-schema.md §5 + dashboard-ui-conventions.md §2.
 *
 * Rendering rules:
 *   - Hidden on section landings (/work, /pipeline, /catalog, /quality,
 *     /operations, /settings).
 *   - Hidden on the root (/) — that page redirects.
 *   - Shown on every page that is at least 2 segments deep.
 *   - Last crumb is non-clickable and has aria-current="page".
 */

import { useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

const SEGMENT_LABELS: Record<string, string> = {
  // Sections
  work: 'Work',
  pipeline: 'Pipeline',
  catalog: 'Catalog',
  quality: 'Quality',
  operations: 'Operations',
  settings: 'Settings',
  // Resources / pages
  prompts: 'Prompts',
  stories: 'Stories',
  tasks: 'Tasks',
  blockers: 'Blockers',
  requirements: 'Requirements',
  questions: 'Questions',
  suggestions: 'Suggestions',
  queue: 'Queue',
  buckets: 'Buckets',
  submit: 'Submit',
  journey: 'Journey',
  timeline: 'Timeline',
  events: 'Events',
  'task-runs': 'Task runs',
  dag: 'DAG',
  agents: 'Agents',
  architecture: 'Architecture',
  contracts: 'Contracts',
  features: 'Features',
  domains: 'Domains',
  projects: 'Projects',
  registry: 'Registry',
  gates: 'Gates',
  tests: 'Tests',
  completeness: 'Completeness',
  health: 'Health',
  observability: 'Observability',
  metrics: 'Metrics',
  llm: 'LLM',
  phase1: 'Phase 1',
  builds: 'Builds',
  audit: 'Audit',
  standards: 'Standards',
  adrs: 'ADRs',
  reports: 'Reports',
};

const SECTION_ROOTS = new Set(['work', 'pipeline', 'catalog', 'quality', 'operations', 'settings']);

const TRUNCATE_AT = 12;

interface Crumb {
  label: string;
  href: string;
  isDynamic: boolean;
  fullValue: string;
  isLast: boolean;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max) + '…';
}

function buildCrumbs(pathname: string): Crumb[] {
  const segments = pathname.split('/').filter(Boolean);
  if (segments.length === 0) return [];
  return segments.map((seg, idx) => {
    const isLast = idx === segments.length - 1;
    const label = SEGMENT_LABELS[seg];
    const href = '/' + segments.slice(0, idx + 1).join('/');
    if (label) {
      return { label, href, isDynamic: false, fullValue: seg, isLast };
    }
    // Dynamic segment — render raw value truncated.
    return {
      label: truncate(seg, TRUNCATE_AT),
      href,
      isDynamic: true,
      fullValue: seg,
      isLast,
    };
  });
}

export function Breadcrumb() {
  const pathname = usePathname();

  const crumbs = useMemo(() => buildCrumbs(pathname || '/'), [pathname]);

  // Hide on section landings (single segment matching a known section root)
  // and on root.
  if (crumbs.length < 2) {
    if (crumbs.length === 1 && SECTION_ROOTS.has(crumbs[0].fullValue)) return null;
    if (crumbs.length === 0) return null;
    // 1 segment that isn't a section root — also hide (it's a top-level page)
    return null;
  }

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        marginBottom: 16,
        fontSize: 13,
        color: '#a0aec0',
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: 4,
      }}
    >
      {crumbs.map((c, idx) => {
        const sep = idx > 0 ? (
          <span aria-hidden="true" style={{ color: '#4a5568', margin: '0 4px' }}>›</span>
        ) : null;
        if (c.isLast) {
          return (
            <span key={c.href} style={{ display: 'inline-flex', alignItems: 'center' }}>
              {sep}
              <span
                aria-current="page"
                title={c.isDynamic ? c.fullValue : undefined}
                style={{ color: '#f0f4f8', fontWeight: 500 }}
              >
                {c.label}
              </span>
            </span>
          );
        }
        return (
          <span key={c.href} style={{ display: 'inline-flex', alignItems: 'center' }}>
            {sep}
            <Link
              href={c.href}
              title={c.isDynamic ? c.fullValue : undefined}
              style={{ color: '#90cdf4', textDecoration: 'none' }}
            >
              {c.label}
            </Link>
          </span>
        );
      })}
    </nav>
  );
}

export default Breadcrumb;
