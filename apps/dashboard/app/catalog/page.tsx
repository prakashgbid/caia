/**
 * Catalog — section landing.
 *
 * DASH-002 stub: a simple TOC card grid linking to the Catalog children
 * (the "what exists in CAIA" surfaces).
 */
'use client';
import Link from 'next/link';

const SECTIONS = [
  { href: '/catalog/projects', label: 'Projects', icon: '📁', desc: 'All projects in the platform.' },
  { href: '/catalog/domains', label: 'Domains', icon: '🏷️', desc: 'Tech sub-domains used to tag entities.' },
  { href: '/catalog/architecture', label: 'Architecture (AKG)', icon: '🏛️', desc: 'Architecture knowledge graph — artifacts, edges, recent extracts.' },
  { href: '/catalog/contracts', label: 'Contracts (ACR)', icon: '📃', desc: 'Agent section contract registry.' },
  { href: '/catalog/features', label: 'Features (FREG)', icon: '🎯', desc: 'Feature registry.' },
  { href: '/catalog/agents', label: 'Agents', icon: '🤖', desc: 'All 24 CAIA agents — status, recent activity, drill-down.' },
  { href: '/catalog/registry', label: 'Registry', icon: '🗂️', desc: 'Cross-cutting artifact registry.' },
];

export default function CatalogLanding() {
  return (
    <div>
      <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, color: '#f0f4f8' }}>📚 Catalog</h1>
      <p style={{ marginTop: 8, color: '#a0aec0', fontSize: 14 }}>
        What exists. Architecture, contracts, features, projects, domains, agents, registry.
      </p>
      <div
        style={{
          marginTop: 24,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
          gap: 12,
        }}
      >
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            style={{
              display: 'block',
              padding: 16,
              background: '#1a1f2e',
              border: '1px solid #2d3748',
              borderRadius: 12,
              textDecoration: 'none',
              color: '#f0f4f8',
              transition: 'border-color 0.15s, transform 0.15s',
            }}
          >
            <div style={{ fontSize: 18, fontWeight: 600 }}>
              <span aria-hidden="true">{s.icon}</span> {s.label}
            </div>
            <div style={{ marginTop: 6, fontSize: 13, color: '#a0aec0' }}>{s.desc}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
