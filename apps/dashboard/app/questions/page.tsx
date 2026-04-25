'use client';
import { useEffect, useState, Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams, useRouter } from 'next/navigation';

interface Question {
  id: string;
  title: string;
  state: string;
  priority: string;
  projectId?: string | null;
  createdAt: string;
  answer?: string | null;
  answeredAt?: string | null;
}

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#742a2a',
  high: '#744210',
  normal: '#2d3748',
  low: '#1a202c',
};

function QuestionsContent() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const project = searchParams.get('project') ?? '';
  const state = searchParams.get('state') ?? '';
  const [items, setItems] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (project) p.set('projectId', project);
    if (state) p.set('state', state);
    fetch(`/api/questions?${p.toString()}`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setItems(data as Question[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project, state]);

  function setFilter(key: string, value: string) {
    const p = new URLSearchParams(searchParams.toString());
    if (value) p.set(key, value);
    else p.delete(key);
    router.push(`/questions?${p.toString()}`);
  }

  const openCount = items.filter(i => i.state === 'open').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>❓ Questions</h1>
        {openCount > 0 && (
          <span style={{ background: '#2a4365', color: '#bee3f8', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
            {openCount} open
          </span>
        )}
        <select
          value={state}
          onChange={e => setFilter('state', e.target.value)}
          style={{ background: '#2d3748', color: '#e2e8f0', border: '1px solid #4a5568', borderRadius: 4, padding: '4px 8px', fontSize: 13 }}
          aria-label="Filter by state"
        >
          <option value="">All states</option>
          <option value="open">Open</option>
          <option value="answered">Answered</option>
          <option value="dismissed">Dismissed</option>
        </select>
      </div>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {items.map(item => (
            <Link key={item.id} href={`/questions/${item.id}`} style={{ textDecoration: 'none' }}>
              <div
                style={{
                  background: '#1a1f2e',
                  borderRadius: 6,
                  padding: '12px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  border: `1px solid ${item.state === 'open' ? '#2a4365' : '#2d3748'}`,
                  cursor: 'pointer',
                }}
              >
                <span
                  style={{
                    background: PRIORITY_COLORS[item.priority] ?? '#2d3748',
                    color: '#e2e8f0',
                    fontSize: 10,
                    padding: '2px 8px',
                    borderRadius: 10,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {item.priority}
                </span>
                <span style={{ flex: 1, color: '#f0f4f8', fontSize: 14 }}>{item.title}</span>
                {item.answeredAt && (
                  <span style={{ fontSize: 11, color: '#68d391', whiteSpace: 'nowrap' }}>answered</span>
                )}
                <span
                  style={{
                    fontSize: 11,
                    color: item.state === 'open' ? '#63b3ed' : '#718096',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {item.state}
                </span>
              </div>
            </Link>
          ))}
          {items.length === 0 && (
            <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No questions</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function QuestionsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <QuestionsContent />
    </Suspense>
  );
}
