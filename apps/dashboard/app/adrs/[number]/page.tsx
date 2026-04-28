'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Adr {
  id: string;
  number: number;
  title: string;
  status: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives: string;
  supersedes?: string | null;
  projectId?: string | null;
  scope: string;
  createdAt: string;
  updatedAt: string;
}

export default function AdrDetailPage({ params }: { params: { number: string } }) {
  const { number } = params;
  const [adr, setAdr] = useState<Adr | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/adrs')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const found = (data as Adr[]).find(a => String(a.number) === number);
          setAdr(found ?? null);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [number]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading...</div>;
  if (!adr) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>ADR #{number} not found</div>
      <Link href="/adrs" style={{ color: '#63b3ed', textDecoration: 'none' }}>← Back</Link>
    </div>
  );

  const alternatives = (() => { try { return JSON.parse(adr.alternatives) as string[]; } catch { return []; } })();

  const Section = ({ title, content }: { title: string; content: string }) => (
    content ? (
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{title}</h3>
        <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {content}
        </div>
      </div>
    ) : null
  );

  return (
    <div style={{ maxWidth: 800 }}>
      <div style={{ fontSize: 13, color: '#718096', marginBottom: 16 }}>
        <Link href="/adrs" style={{ color: '#63b3ed', textDecoration: 'none' }}>ADRs</Link>
        {' / '}
        <span style={{ fontFamily: 'monospace', color: '#a0aec0' }}>#{String(adr.number).padStart(3, '0')}</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 24 }}>
        <div>
          <div style={{ fontSize: 12, color: '#718096', marginBottom: 4 }}>ADR-{String(adr.number).padStart(3, '0')}</div>
          <h1 style={{ margin: 0, fontSize: 22, color: '#f0f4f8' }}>{adr.title}</h1>
        </div>
        <span style={{ fontSize: 11, background: '#2d3748', color: '#e2e8f0', padding: '4px 10px', borderRadius: 10, flexShrink: 0, marginTop: 4 }}>
          {adr.status}
        </span>
      </div>

      <Section title="Context" content={adr.context} />
      <Section title="Decision" content={adr.decision} />
      <Section title="Consequences" content={adr.consequences} />

      {alternatives.length > 0 && (
        <div style={{ marginBottom: 20 }}>
          <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Alternatives Considered</h3>
          <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '10px 14px', border: '1px solid #2d3748' }}>
            {alternatives.map((a, i) => (
              <div key={i} style={{ fontSize: 13, color: '#a0aec0', marginBottom: 4, paddingLeft: 8, borderLeft: '2px solid #4a5568' }}>{a}</div>
            ))}
          </div>
        </div>
      )}

      <div style={{ fontSize: 12, color: '#4a5568' }}>
        Created {new Date(adr.createdAt).toLocaleDateString()} · Updated {new Date(adr.updatedAt).toLocaleDateString()}
      </div>
    </div>
  );
}
