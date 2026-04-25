'use client';
import React, { useState } from 'react';

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
                  <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.6 }}>{adr.context}</p>
                </div>
                <div style={{ marginTop: '12px' }}>
                  <h4 style={{ color: '#718096', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Decision</h4>
                  <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.6 }}>{adr.decision}</p>
                </div>
                {adr.consequences && (
                  <div style={{ marginTop: '12px' }}>
                    <h4 style={{ color: '#718096', fontSize: '11px', textTransform: 'uppercase', marginBottom: '4px' }}>Consequences</h4>
                    <p style={{ color: '#e2e8f0', fontSize: '13px', lineHeight: 1.6 }}>{adr.consequences}</p>
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
