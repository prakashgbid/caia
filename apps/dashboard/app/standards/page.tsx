'use client';
import useSWR from 'swr';
import { useState } from 'react';

const fetcher = (url: string) => fetch(url).then(r => r.json());

interface LockContract {
  id: string;
  slug: string;
  kind: string;
  title: string;
  bodyMd: string;
  version: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  checksum: string;
  revisions?: Array<{ id: number; version: number; changedAt: string; changedBy: string }>;
}

const KIND_COLOR: Record<string, string> = {
  brand: '#9f7aea',
  a11y: '#68d391',
  domain: '#63b3ed',
  policy: '#f6ad55',
  protocol: '#fc8181',
  standard: '#a0aec0',
};

function MarkdownBody({ md }: { md: string }) {
  const lines = md.split('\n');
  return (
    <div style={{ fontSize: 13, lineHeight: 1.7, color: '#cbd5e0' }}>
      {lines.map((line, i) => {
        if (line.startsWith('## ')) return <h3 key={i} style={{ color: '#90cdf4', margin: '12px 0 4px', fontSize: 14 }}>{line.slice(3)}</h3>;
        if (line.startsWith('# ')) return <h2 key={i} style={{ color: '#e2e8f0', margin: '16px 0 6px', fontSize: 16 }}>{line.slice(2)}</h2>;
        if (line.startsWith('- ')) return <li key={i} style={{ marginLeft: 16, marginBottom: 2 }}>{line.slice(2)}</li>;
        if (line.trim() === '') return <div key={i} style={{ height: 8 }} />;
        return <p key={i} style={{ margin: '4px 0' }}>{line}</p>;
      })}
    </div>
  );
}

export default function StandardsPage() {
  const { data: contracts, isLoading, mutate } = useSWR<LockContract[]>('/api/lock-contracts-proxy', fetcher, { refreshInterval: 60000 });
  const [selected, setSelected] = useState<LockContract | null>(null);
  const [kindFilter, setKindFilter] = useState('');

  const all = contracts ?? [];
  const filtered = kindFilter ? all.filter(c => c.kind === kindFilter) : all;
  const kinds = [...new Set(all.map(c => c.kind))];

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 48px)' }}>
      {/* List panel */}
      <div style={{ width: 320, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <h1 style={{ margin: 0, fontSize: 20, color: '#90cdf4' }}>📋 Standards</h1>
          <span style={{ color: '#718096', fontSize: 13 }}>{all.length} contracts</span>
        </div>
        <select
          value={kindFilter}
          onChange={e => setKindFilter(e.target.value)}
          style={{ background: '#1a1f2e', border: '1px solid #4a5568', color: '#e2e8f0', borderRadius: 6, padding: '5px 8px', fontSize: 12, marginBottom: 8 }}
          aria-label="Filter by kind"
        >
          <option value="">All kinds</option>
          {kinds.map(k => <option key={k} value={k}>{k}</option>)}
        </select>

        {isLoading && <div style={{ color: '#a0aec0', fontSize: 13 }}>Loading...</div>}

        {filtered.length === 0 && !isLoading && (
          <div data-empty-state style={{ color: '#718096', padding: 20, textAlign: 'center', border: '1px dashed #4a5568', borderRadius: 8, fontSize: 13 }}>
            No contracts. Use <code>lock_contract_upsert</code> MCP tool to seed.
          </div>
        )}

        <div data-test-region="contracts-list" style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.map(c => (
            <button
              key={c.slug}
              onClick={() => setSelected(c)}
              style={{
                width: '100%', textAlign: 'left', background: selected?.slug === c.slug ? '#2d3748' : '#1a1f2e',
                border: `1px solid ${selected?.slug === c.slug ? '#63b3ed' : '#2d3748'}`,
                borderLeft: `3px solid ${KIND_COLOR[c.kind] ?? '#4a5568'}`,
                borderRadius: 6, padding: '10px 12px', cursor: 'pointer', marginBottom: 4,
                color: '#e2e8f0',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                <span style={{ fontSize: 10, padding: '1px 5px', borderRadius: 4, background: KIND_COLOR[c.kind] + '22', color: KIND_COLOR[c.kind], fontWeight: 700, textTransform: 'uppercase' }}>
                  {c.kind}
                </span>
                <span style={{ fontSize: 10, color: '#718096' }}>v{c.version}</span>
                {!c.active && <span style={{ fontSize: 10, color: '#fc8181' }}>inactive</span>}
              </div>
              <div style={{ fontSize: 13, fontWeight: 600 }}>{c.title}</div>
              <div style={{ fontSize: 11, color: '#718096', fontFamily: 'monospace', marginTop: 2 }}>{c.slug}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Detail panel */}
      <div style={{ flex: 1, overflowY: 'auto', borderLeft: '1px solid #2d3748', paddingLeft: 24 }}>
        {!selected ? (
          <div data-empty-state style={{ color: '#718096', padding: 40, textAlign: 'center' }}>
            Select a contract to view its content and version history.
          </div>
        ) : (
          <div data-test-region="contract-detail">
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, marginBottom: 20 }}>
              <div style={{ flex: 1 }}>
                <h2 style={{ margin: '0 0 4px', fontSize: 20, color: '#e2e8f0' }}>{selected.title}</h2>
                <div style={{ fontSize: 12, color: '#718096' }}>
                  <span style={{ marginRight: 12 }}><span style={{ color: '#4a5568' }}>slug:</span> <code style={{ color: '#90cdf4' }}>{selected.slug}</code></span>
                  <span style={{ marginRight: 12 }}><span style={{ color: '#4a5568' }}>kind:</span> {selected.kind}</span>
                  <span style={{ marginRight: 12 }}><span style={{ color: '#4a5568' }}>version:</span> v{selected.version}</span>
                  <span><span style={{ color: '#4a5568' }}>updated:</span> {new Date(selected.updatedAt).toLocaleString()}</span>
                </div>
              </div>
              <div style={{ fontSize: 11, fontFamily: 'monospace', color: '#4a5568', padding: '4px 8px', background: '#1a1f2e', borderRadius: 4 }}>
                sha256: {selected.checksum.slice(0, 16)}…
              </div>
            </div>

            <div style={{ background: '#141820', border: '1px solid #2d3748', borderRadius: 8, padding: 20, marginBottom: 20 }}>
              <MarkdownBody md={selected.bodyMd} />
            </div>

            {selected.revisions && selected.revisions.length > 0 && (
              <div>
                <h3 style={{ fontSize: 14, color: '#e2e8f0', margin: '0 0 10px' }}>Version history ({selected.revisions.length})</h3>
                <div style={{ background: '#1a1f2e', border: '1px solid #2d3748', borderRadius: 6, overflow: 'hidden' }}>
                  {selected.revisions.map(rev => (
                    <div key={rev.id} style={{ padding: '8px 14px', borderBottom: '1px solid #2d3748', display: 'flex', gap: 12, fontSize: 12 }}>
                      <span style={{ color: '#63b3ed', fontWeight: 700, minWidth: 30 }}>v{rev.version}</span>
                      <span style={{ color: '#718096' }}>{new Date(rev.changedAt).toLocaleString()}</span>
                      <span style={{ color: '#a0aec0' }}>by {rev.changedBy}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
