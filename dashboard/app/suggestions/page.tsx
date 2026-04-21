'use client';
import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';

interface Suggestion {
  id: string;
  title: string;
  rationale: string;
  options: string;
  state: string;
  acceptedOption?: string | null;
  customAnswer?: string | null;
  projectId?: string | null;
  createdAt: string;
  resolvedAt?: string | null;
}

const STATE_COLORS: Record<string, string> = {
  pending: '#744210',
  accepted: '#276749',
  rejected: '#742a2a',
  dismissed: '#2d3748',
};

function SuggestionsContent() {
  const searchParams = useSearchParams();
  const project = searchParams.get('project') ?? '';
  const [items, setItems] = useState<Suggestion[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    const p = new URLSearchParams();
    if (project) p.set('projectId', project);
    fetch(`/api/suggestions?${p.toString()}`)
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setItems(data as Suggestion[]);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [project]);

  const pending = items.filter(i => i.state === 'pending').length;

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: '#f0f4f8' }}>💡 Suggestions</h1>
        {pending > 0 && (
          <span style={{ background: '#276749', color: '#9ae6b4', fontSize: 12, fontWeight: 700, padding: '2px 8px', borderRadius: 10 }}>
            {pending} pending
          </span>
        )}
        <span style={{ fontSize: 13, color: '#718096' }}>{items.length} total</span>
      </div>

      {loading ? (
        <div style={{ color: '#718096', padding: 16 }}>Loading...</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {items.map(item => {
            const options = (() => { try { return JSON.parse(item.options) as string[]; } catch { return []; } })();
            return (
              <div
                key={item.id}
                style={{
                  background: '#1a1f2e',
                  borderRadius: 8,
                  padding: 16,
                  border: `1px solid ${item.state === 'pending' ? '#744210' : '#2d3748'}`,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, color: '#f0f4f8', fontSize: 15, marginBottom: 4 }}>{item.title}</div>
                    {item.rationale && (
                      <div style={{ fontSize: 13, color: '#a0aec0' }}>{item.rationale}</div>
                    )}
                  </div>
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
                </div>

                {options.length > 0 && (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
                    {options.map((opt, i) => (
                      <span
                        key={i}
                        style={{
                          background: item.acceptedOption === opt ? '#1c4532' : '#0f1117',
                          color: item.acceptedOption === opt ? '#9ae6b4' : '#718096',
                          border: `1px solid ${item.acceptedOption === opt ? '#276749' : '#2d3748'}`,
                          fontSize: 12,
                          padding: '3px 10px',
                          borderRadius: 4,
                        }}
                      >
                        {opt}
                      </span>
                    ))}
                  </div>
                )}

                {item.customAnswer && (
                  <div style={{ marginTop: 8, fontSize: 13, color: '#68d391', fontStyle: 'italic' }}>
                    Custom: {item.customAnswer}
                  </div>
                )}
              </div>
            );
          })}
          {items.length === 0 && (
            <div style={{ color: '#718096', padding: 24, textAlign: 'center' }}>No suggestions</div>
          )}
        </div>
      )}
    </div>
  );
}

export default function SuggestionsPage() {
  return (
    <Suspense fallback={<div style={{ color: '#718096', padding: 32 }}>Loading...</div>}>
      <SuggestionsContent />
    </Suspense>
  );
}
