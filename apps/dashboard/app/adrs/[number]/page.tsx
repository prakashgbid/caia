'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { parseTradeoffs } from '../../../lib/adr-tradeoffs';

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

const GROUP_CONFIG = {
  positive: { bg: '#1a2e1a', border: '#276749', headerColor: '#68d391', textColor: '#c6f6d5', icon: '✓', label: 'Positive' },
  negative: { bg: '#2d1f0e', border: '#744210', headerColor: '#f6ad55', textColor: '#fbd38d', icon: '!', label: 'Trade-offs' },
} as const;

function TradeOffsSection({ consequences }: { consequences: string }) {
  if (!consequences) return null;

  const { positive, negative, raw, structured } = parseTradeoffs(consequences);

  if (!structured) {
    return (
      <div style={{ marginBottom: 20 }}>
        <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Consequences
        </h3>
        <div style={{ background: '#1a1f2e', borderRadius: 6, padding: '12px 14px', border: '1px solid #2d3748', fontSize: 13, color: '#e2e8f0', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>
          {raw}
        </div>
      </div>
    );
  }

  const groups = [
    positive.length > 0 ? { type: 'positive' as const, items: positive } : null,
    negative.length > 0 ? { type: 'negative' as const, items: negative } : null,
  ].filter(Boolean) as Array<{ type: 'positive' | 'negative'; items: string[] }>;

  return (
    <div style={{ marginBottom: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <h3 style={{ margin: 0, fontSize: 14, color: '#a0aec0', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          Consequences
        </h3>
        <div style={{ display: 'flex', gap: 6 }}>
          {positive.length > 0 && (
            <span style={{ fontSize: 11, background: '#1a2e1a', border: '1px solid #276749', color: '#68d391', padding: '2px 8px', borderRadius: 10 }}>
              +{positive.length}
            </span>
          )}
          {negative.length > 0 && (
            <span style={{ fontSize: 11, background: '#2d1f0e', border: '1px solid #744210', color: '#f6ad55', padding: '2px 8px', borderRadius: 10 }}>
              −{negative.length}
            </span>
          )}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: groups.length > 1 ? '1fr 1fr' : '1fr', gap: 10 }}>
        {groups.map((group) => {
          const cfg = GROUP_CONFIG[group.type];
          return (
            <div key={group.type} style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 8, padding: '12px 14px' }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: cfg.headerColor, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span style={{ width: 16, height: 16, borderRadius: 4, background: cfg.border, color: cfg.headerColor, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 9 }}>
                  {cfg.icon}
                </span>
                {cfg.label}
                <span style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 400, opacity: 0.7 }}>{group.items.length}</span>
              </div>
              <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {group.items.map((item, i) => (
                  <li key={i} style={{ display: 'flex', gap: 8, marginBottom: i < group.items.length - 1 ? 7 : 0, alignItems: 'flex-start' }}>
                    <span style={{ color: cfg.headerColor, marginTop: 4, flexShrink: 0, fontSize: 8 }}>▸</span>
                    <span style={{ color: cfg.textColor, fontSize: 12, lineHeight: 1.55 }}>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
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
      <TradeOffsSection consequences={adr.consequences} />

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
