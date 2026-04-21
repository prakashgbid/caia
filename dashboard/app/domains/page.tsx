'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';
import { Suspense } from 'react';

interface DomainWithCounts {
  slug: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  parentSlug?: string | null;
  createdAt: string;
  counts: Record<string, number>;
  totalEntities: number;
}

const ENTITY_TYPE_LABELS: Record<string, string> = {
  requirement: 'req',
  blocker: 'bl',
  question: 'q',
  adr: 'adr',
  feature: 'feat',
  suggestion: 'sug',
  timeline: 'tl',
};

function CountBadge({ label, count, color }: { label: string; count: number; color: string }) {
  if (!count) return null;
  return (
    <span
      style={{
        fontSize: 10,
        background: color + '22',
        color,
        border: `1px solid ${color}44`,
        borderRadius: 8,
        padding: '1px 5px',
        whiteSpace: 'nowrap',
      }}
      aria-label={`${count} ${label}`}
    >
      {label} {count}
    </span>
  );
}

function DomainsContent() {
  const [domains, setDomains] = useState<DomainWithCounts[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    fetch('/api/domains')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setDomains(data as DomainWithCounts[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = search
    ? domains.filter(d =>
        d.name.toLowerCase().includes(search.toLowerCase()) ||
        d.description.toLowerCase().includes(search.toLowerCase()) ||
        d.slug.includes(search.toLowerCase())
      )
    : domains;

  // Sort: domains with entities first, then alphabetical
  const sorted = [...filtered].sort((a, b) => {
    if (b.totalEntities !== a.totalEntities) return b.totalEntities - a.totalEntities;
    return a.name.localeCompare(b.name);
  });

  if (loading) {
    return <div style={{ color: '#718096', padding: 32 }}>Loading domains...</div>;
  }

  return (
    <div>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>
          🏷️ Domains
        </h1>
        <span style={{ fontSize: 13, color: '#718096' }}>{domains.length} domains</span>
        <div style={{ flex: 1 }} />
        <input
          type="search"
          placeholder="Search domains..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          style={{
            background: '#2d3748',
            color: '#e2e8f0',
            border: '1px solid #4a5568',
            borderRadius: 4,
            padding: '6px 10px',
            fontSize: 13,
            width: 200,
          }}
          aria-label="Search domains"
        />
      </div>

      {sorted.length === 0 ? (
        <div style={{ color: '#718096', padding: 32, textAlign: 'center' }}>
          {search ? 'No domains match your search.' : 'No domains found.'}
        </div>
      ) : (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))',
            gap: 12,
          }}
          role="list"
          aria-label="Domain list"
        >
          {sorted.map(d => (
            <Link
              key={d.slug}
              href={`/domains/${d.slug}`}
              style={{ textDecoration: 'none' }}
              role="listitem"
            >
              <div
                style={{
                  background: '#1a1f2e',
                  borderRadius: 8,
                  padding: 16,
                  border: `1px solid ${d.color}44`,
                  borderLeft: `4px solid ${d.color}`,
                  cursor: 'pointer',
                  transition: 'box-shadow 0.15s',
                  minHeight: 110,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 8,
                }}
                aria-label={`Domain: ${d.name}, ${d.totalEntities} entities`}
              >
                {/* Title row */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span
                    style={{ fontSize: 20, flexShrink: 0 }}
                    aria-hidden="true"
                  >
                    {d.icon}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontWeight: 600, color: '#f0f4f8', fontSize: 14, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {d.name}
                    </div>
                    <div style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace' }}>{d.slug}</div>
                  </div>
                  {d.totalEntities > 0 && (
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 700,
                        color: d.color,
                        background: d.color + '22',
                        border: `1px solid ${d.color}44`,
                        borderRadius: 10,
                        padding: '2px 7px',
                        flexShrink: 0,
                      }}
                      aria-label={`${d.totalEntities} total entities`}
                    >
                      {d.totalEntities}
                    </span>
                  )}
                </div>

                {/* Description */}
                {d.description && (
                  <div style={{ fontSize: 12, color: '#a0aec0', lineHeight: 1.4, overflow: 'hidden', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
                    {d.description}
                  </div>
                )}

                {/* Entity type counts */}
                {d.totalEntities > 0 && (
                  <div
                    style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 'auto' }}
                    aria-label="Entity breakdown"
                  >
                    {Object.entries(ENTITY_TYPE_LABELS).map(([type, label]) => (
                      d.counts[type] ? (
                        <CountBadge key={type} label={label} count={d.counts[type] ?? 0} color={d.color} />
                      ) : null
                    ))}
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

export default function DomainsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading domains...</div>}>
      <DomainsContent />
    </Suspense>
  );
}
