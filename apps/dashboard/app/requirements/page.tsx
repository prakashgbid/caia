'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

interface Requirement {
  id: string;
  title: string;
  state: string;
  priority: number;
  projectId?: string | null;
  createdAt: string;
}

const STATE_COLORS: Record<string, string> = {
  captured: '#2d3748',
  refining: '#2b6cb0',
  specced: '#2c7a7b',
  ready: '#276749',
  executing: '#744210',
  verifying: '#553c9a',
  done: '#276749',
  blocked: '#742a2a',
  cancelled: '#1a202c',
};

const STATES = ['captured', 'refining', 'specced', 'ready', 'executing', 'verifying', 'done', 'blocked', 'cancelled'];

function RequirementsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const project = searchParams.get('project') ?? '';
  const state = searchParams.get('state') ?? '';
  const [items, setItems] = useState<Requirement[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (project) p.set('projectId', project);
    if (state) p.set('state', state);
    fetch(`/api/requirements?${p.toString()}`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setItems(data as Requirement[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project, state]);

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/requirements?${p.toString()}`);
  }

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>📝 Requirements</h1>
        <select
          value={state}
          onChange={e => setFilter('state', e.target.value)}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          {STATES.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        <span style={{ fontSize: 13, color: '#718096' }}>{items.length} requirements</span>
      </div>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(item => (
            <Link key={item.id} href={`/requirements/${item.id}`} style={{ textDecoration: 'none' }}>
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
                    background: STATE_COLORS[item.state] ?? '#2d3748',
                    color: '#e2e8f0',
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 10,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {item.state}
                </span>
                <span style={{ flex: 1, color: '#f0f4f8', fontSize: 14 }}>{item.title}</span>
                <span
                  style={{
                    fontSize: 11,
                    color: item.priority <= 1 ? '#fc8181' : item.priority <= 2 ? '#f6ad55' : '#718096',
                    whiteSpace: 'nowrap',
                  }}
                >
                  P{item.priority}
                </span>
              </div>
            </Link>
          ))}
          {items.length === 0 && (
            <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No requirements</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function RequirementsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <RequirementsContent />
    </Suspense>
  );
}
