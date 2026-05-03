'use client';

/**
 * LineagePanel — parent-child lineage strip for detail pages (DASH-004).
 *
 * Renders parents left-to-right with `›` separators (each clickable) and a
 * compact summary of children counts (each clickable to a filtered sibling
 * view). Pure presentational — the calling page is responsible for fetching
 * its own lineage data from existing API endpoints (no new backend code).
 *
 * Spec: caia/docs/dashboard-ui-conventions.md §3 (drill-down pattern).
 */

import Link from 'next/link';

export interface LineageNode {
  /** Friendly label (e.g. "Initiative", "Story"). */
  kind: string;
  /** Stable id rendered next to the kind (e.g. "init_007"). */
  id: string;
  /** Optional title to show on hover. */
  title?: string;
  /** Where this node lives in the IA. Click navigates here. */
  href: string;
}

export interface LineageChildSummary {
  /** Plural label, e.g. "stories". */
  label: string;
  /** Count to render. */
  count: number;
  /** Optional click target — typically a filtered sibling view. */
  href?: string;
}

interface LineagePanelProps {
  parents: LineageNode[];
  children?: LineageChildSummary[];
}

export function LineagePanel({ parents, children = [] }: LineagePanelProps) {
  if (parents.length === 0 && children.length === 0) return null;
  return (
    <section
      aria-label="Lineage"
      style={{
        margin: '0 0 16px',
        padding: '10px 12px',
        background: '#1a1f2e',
        border: '1px solid #2d3748',
        borderRadius: 8,
        fontSize: 13,
        color: '#cbd5e0',
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'center',
      }}
    >
      {parents.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
          <span style={{ color: '#718096', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}>
            Lineage
          </span>
          {parents.map((p, idx) => (
            <span key={p.href} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {idx > 0 && (
                <span aria-hidden="true" style={{ color: '#4a5568' }}>›</span>
              )}
              <Link
                href={p.href}
                title={p.title}
                style={{ color: '#90cdf4', textDecoration: 'none' }}
              >
                <span style={{ color: '#a0aec0' }}>{p.kind}:</span> {p.id}
              </Link>
            </span>
          ))}
          <span aria-hidden="true" style={{ color: '#4a5568' }}>›</span>
          <span style={{ color: '#f0f4f8', fontWeight: 600 }}>this</span>
        </div>
      )}
      {children.length > 0 && (
        <div
          style={{
            marginLeft: parents.length > 0 ? 16 : 0,
            paddingLeft: parents.length > 0 ? 16 : 0,
            borderLeft: parents.length > 0 ? '1px solid #2d3748' : 'none',
            display: 'flex',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          <span style={{ color: '#718096', textTransform: 'uppercase', fontSize: 10, letterSpacing: '0.05em' }}>
            Children
          </span>
          {children.map((c) => {
            const content = (
              <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
                <span style={{ color: '#f0f4f8', fontWeight: 600 }}>{c.count}</span>
                <span style={{ color: '#a0aec0' }}>{c.label}</span>
              </span>
            );
            return c.href ? (
              <Link key={c.label} href={c.href} style={{ textDecoration: 'none' }}>
                {content}
              </Link>
            ) : (
              <span key={c.label}>{content}</span>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default LineagePanel;
