'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

interface Adr {
  id: string;
  number: number;
  title: string;
  status: string;
  projectId?: string | null;
  createdAt: string;
}

const STATUS_COLORS: Record<string, string> = {
  proposed: '#2b6cb0',
  accepted: '#276749',
  rejected: '#742a2a',
  deprecated: '#2d3748',
  superseded: '#553c9a',
};

function AdrsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const project = searchParams.get('project') ?? '';
  const status = searchParams.get('status') ?? '';
  const [items, setItems] = useState<Adr[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (project) p.set('projectId', project);
    fetch(`/api/adrs?${p.toString()}`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          let filtered = data as Adr[];
          if (status) filtered = filtered.filter(a => a.status === status);
          setItems(filtered);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project, status]);

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/adrs?${p.toString()}`);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📜 ADRs</h1>
        <select
          value={status}
          onChange={e => setFilter('status', e.target.value)}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by status"
        >
          <option value="">All statuses</option>
          {['proposed', 'accepted', 'rejected', 'deprecated', 'superseded'].map(s => (
            <option key={s} value={s}>{s}</option>
          ))}
        </select>
        <span style={{ fontSize: 13, color: '#718096' }}>{items.length} ADRs</span>
      </div>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.sort((a, b) => a.number - b.number).map(item => (
            <Link key={item.id} href={`/adrs/${item.number}`} style={{ textDecoration: 'none' }}>
              <div
                style={{
                  background: '#1a1f2e',
                  borderRadius: 6,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  border: '1px solid #2d3748',
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    fontFamily: 'monospace',
                    fontSize: 13,
                    color: '#718096',
                    flexShrink: 0,
                    minWidth: 40,
                  }}
                >
                  #{String(item.number).padStart(3, '0')}
                </span>
                <span style={{ flex: 1, color: '#f0f4f8', fontSize: 14 }}>{item.title}</span>
                <span
                  style={{
                    background: STATUS_COLORS[item.status] ?? '#2d3748',
                    color: '#e2e8f0',
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 10,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.status}
                </span>
              </div>
            </Link>
          ))}
          {items.length === 0 && (
            <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No ADRs</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function AdrsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <AdrsContent />
    </Suspense>
  );
}
