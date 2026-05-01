'use client';
import React, { useState } from 'react';
import { parseTradeoffs } from '../lib/adr-tradeoffs';

export interface Adr {
  id: string;
  number: number;
  title: string;
  status: string;
  context: string;
  decision: string;
  consequences: string;
  alternatives: string;
  projectId?: string | null;
  createdAt: string;
  updatedAt: string;
}

interface Props {
  adrs: Adr[];
}

const STATUS_COLORS: Record<string, string> = {
  proposed: '#D69E2E',
  accepted: '#38A169',
  deprecated: '#718096',
  superseded: '#E53E3E',
};

function MiniTradeOffs({ consequences }: { consequences: string }) {
  if (!consequences) return null;

  const { positive, negative, raw, structured } = parseTradeoffs(consequences);

  if (!structured) {
    return <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>{raw}</p>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {positive.length > 0 && (
        <div style={{ background: '#1a2e1a', border: '1px solid #276749', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#68d391', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
            ✓ Positive · {positive.length}
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {positive.map((item, i) => (
              <li key={i} style={{ display: 'flex', gap: 6, marginBottom: i < positive.length - 1 ? 4 : 0, alignItems: 'flex-start' }}>
                <span style={{ color: '#68d391', marginTop: 3, flexShrink: 0, fontSize: 7 }}>▸</span>
                <span style={{ color: '#c6f6d5', fontSize: 12, lineHeight: 1.5 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {negative.length > 0 && (
        <div style={{ background: '#2d1f0e', border: '1px solid #744210', borderRadius: 6, padding: '8px 10px' }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#f6ad55', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 6 }}>
            ! Trade-offs · {negative.length}
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {negative.map((item, i) => (
              <li key={i} style={{ display: 'flex', gap: 6, marginBottom: i < negative.length - 1 ? 4 : 0, alignItems: 'flex-start' }}>
                <span style={{ color: '#f6ad55', marginTop: 3, flexShrink: 0, fontSize: 7 }}>▸</span>
                <span style={{ color: '#fbd38d', fontSize: 12, lineHeight: 1.5 }}>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function AdrsList({ adrs }: Props) {
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = adrs.filter(a => {
    const matchesSearch = !search || a.title.toLowerCase().includes(search.toLowerCase());
    const matchesStatus = !statusFilter || a.status === statusFilter;
    return matchesSearch && matchesStatus;
  });

  return (
    <div>
      <div style={{ display: 'flex', gap: '8px', marginBottom: '16px', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search ADRs..."
          style={{
            padding: '6px 12px',
            background: '#2d3748',
            border: '1px solid #4a5568',
            borderRadius: '6px',
            color: '#f7fafc',
            fontSize: '13px',
            flex: 1,
            minWidth: '180px',
          }}
        />
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{
            padding: '6px 12px',
            background: '#2d3748',
            border: '1px solid #4a5568',
            borderRadius: '6px',
            color: '#f7fafc',
            fontSize: '13px',
          }}
        >
          <option value="">All statuses</option>
          <option value="proposed">Proposed</option>
          <option value="accepted">Accepted</option>
          <option value="deprecated">Deprecated</option>
          <option value="superseded">Superseded</option>
        </select>
      </div>

      {filtered.length === 0 && (
        <div style={{ color: '#718096', textAlign: 'center', padding: '40px' }}>
          No ADRs found.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {filtered.map(adr => (
          <div
            key={adr.id}
            style={{
              background: '#1a202c',
              border: '1px solid #2d3748',
              borderRadius: '8px',
              overflow: 'hidden',
            }}
          >
            <button
              onClick={() => setExpanded(expanded === adr.id ? null : adr.id)}
              style={{
                width: '100%',
                padding: '12px 16px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
                textAlign: 'left',
              }}
            >
              <span style={{ color: '#718096', fontSize: '12px', minWidth: '40px' }}>
                ADR-{String(adr.number).padStart(3, '0')}
              </span>
              <span style={{ color: '#f7fafc', fontSize: '14px', fontWeight: '500', flex: 1 }}>
                {adr.title}
              </span>
              <span style={{
                padding: '2px 8px',
                borderRadius: '10px',
                fontSize: '11px',
                background: (STATUS_COLORS[adr.status] ?? '#718096') + '33',
                color: STATUS_COLORS[adr.status] ?? '#718096',
                fontWeight: '600',
              }}>
                {adr.status}
              </span>
            </button>

            {expanded === adr.id && (
              <div style={{ padding: '0 16px 16px', borderTop: '1px solid #2d3748' }}>
                <div style={{ marginTop: '12px' }}>
                  <h4 style={{ color: '#718096', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Context</h4>
                  <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>{adr.context}</p>
                </div>
                <div style={{ marginTop: '12px' }}>
                  <h4 style={{ color: '#718096', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Decision</h4>
                  <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.6, margin: 0 }}>{adr.decision}</p>
                </div>
                {adr.consequences && (
                  <div style={{ marginTop: '12px' }}>
                    <h4 style={{ color: '#718096', fontSize: '11px', textTransform: 'uppercase', marginBottom: '6px' }}>Consequences</h4>
                    <MiniTradeOffs consequences={adr.consequences} />
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
