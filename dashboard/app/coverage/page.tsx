'use client';
import { useState, useEffect } from 'react';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';
const COVERAGE_URL = '/reports/coverage/coverage-summary.json';

interface FileSummary {
  lines: { total: number; covered: number; pct: number };
  functions: { total: number; covered: number; pct: number };
  branches: { total: number; covered: number; pct: number };
  statements: { total: number; covered: number; pct: number };
}

type CoverageSummary = Record<string, FileSummary>;

function pctColor(pct: number): string {
  if (pct >= 95) return '#16a34a';
  if (pct >= 80) return '#d97706';
  return '#dc2626';
}

function PctBar({ pct }: { pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 80, background: '#f3f4f6', height: 8, borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: pctColor(pct), borderRadius: 4 }} />
      </div>
      <span style={{ fontSize: 11, color: pctColor(pct), fontWeight: 600, minWidth: 36 }}>{pct.toFixed(1)}%</span>
    </div>
  );
}

export default function CoveragePage() {
  const [summary, setSummary] = useState<CoverageSummary | null>(null);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState<'file' | 'lines'>('lines');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    // Try to load from local Next.js public dir, fall back to API proxy
    fetch(COVERAGE_URL)
      .then(r => { if (!r.ok) throw new Error('not found'); return r.json() as Promise<CoverageSummary>; })
      .then(d => { setSummary(d); setLoading(false); })
      .catch(() => {
        setError('No coverage report found. Run: npm test -- --coverage');
        setLoading(false);
      });
  }, []);

  if (loading) return <div style={{ padding: 20, color: '#9ca3af' }}>Loading coverage report…</div>;

  if (error) {
    return (
      <div style={{ padding: 20, fontFamily: 'system-ui' }}>
        <h2>Coverage</h2>
        <div style={{ background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 8, padding: 16, color: '#92400e' }}>
          {error}
        </div>
      </div>
    );
  }

  const total = summary?.['total'];
  const files = Object.entries(summary ?? {})
    .filter(([f]) => f !== 'total' && f.endsWith('.ts') && !f.endsWith('.d.ts'))
    .filter(([f]) => !filter || f.toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => sortBy === 'file' ? a[0].localeCompare(b[0]) : a[1].lines.pct - b[1].lines.pct);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <h2 style={{ marginBottom: 4 }}>Coverage</h2>
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 16 }}>
        Per-file coverage from the latest test run.
      </p>

      {total && (
        <div style={{ display: 'flex', gap: 20, marginBottom: 20, flexWrap: 'wrap' }}>
          {(['statements', 'branches', 'functions', 'lines'] as const).map(k => (
            <div key={k} style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: '10px 16px', minWidth: 120 }}>
              <div style={{ fontSize: 11, color: '#9ca3af', marginBottom: 4, textTransform: 'capitalize' }}>{k}</div>
              <PctBar pct={total[k].pct} />
              <div style={{ fontSize: 11, color: '#9ca3af', marginTop: 2 }}>{total[k].covered}/{total[k].total}</div>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <input
          placeholder="Filter files…"
          value={filter}
          onChange={e => setFilter(e.target.value)}
          style={{ flex: 1, padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
        />
        <select
          value={sortBy}
          onChange={e => setSortBy(e.target.value as 'file' | 'lines')}
          style={{ padding: '6px 10px', border: '1px solid #d1d5db', borderRadius: 6, fontSize: 12 }}
        >
          <option value="lines">Sort by coverage</option>
          <option value="file">Sort by file</option>
        </select>
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '6px 10px', textAlign: 'left' }}>File</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', width: 120 }}>Lines</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', width: 120 }}>Functions</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', width: 120 }}>Branches</th>
          </tr>
        </thead>
        <tbody>
          {files.map(([file, data]) => (
            <tr key={file} style={{ borderBottom: '1px solid #f3f4f6', background: data.lines.pct < 80 ? '#fff5f5' : undefined }}>
              <td style={{ padding: '5px 10px', fontFamily: 'monospace', fontSize: 11, color: '#374151', maxWidth: 400 }}>
                {file.replace(/^.*conductor\//g, '')}
              </td>
              <td style={{ padding: '5px 10px' }}><PctBar pct={data.lines.pct} /></td>
              <td style={{ padding: '5px 10px' }}><PctBar pct={data.functions.pct} /></td>
              <td style={{ padding: '5px 10px' }}><PctBar pct={data.branches.pct} /></td>
            </tr>
          ))}
        </tbody>
      </table>

      {files.length === 0 && filter && (
        <div style={{ textAlign: 'center', padding: 20, color: '#9ca3af' }}>No files match "{filter}"</div>
      )}
    </div>
  );
}
