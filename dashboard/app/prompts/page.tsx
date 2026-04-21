'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface Prompt {
  id: string;
  body: string;
  receivedAt: string;
  receivedVia: string;
  status: string;
  elapsedMs?: number | null;
  userId?: string | null;
  sessionId?: string | null;
}

const STATUS_COLOR: Record<string, string> = {
  received: '#6b7280',
  analyzing: '#2563eb',
  decomposed: '#7c3aed',
  answered: '#16a34a',
  failed: '#dc2626',
};

function statusChip(status: string) {
  return (
    <span style={{
      background: STATUS_COLOR[status] ?? '#6b7280',
      color: '#fff',
      fontSize: 11,
      padding: '2px 8px',
      borderRadius: 12,
      fontWeight: 700,
    }}>{status}</span>
  );
}

export default function PromptsPage() {
  const [prompts, setPrompts] = useState<(Prompt & { descendants_count?: number })[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('');

  const load = (status?: string) => {
    setLoading(true);
    const qs = status ? `?status=${status}&limit=100` : '?limit=100';
    fetch(`${API}/prompts${qs}`)
      .then(r => r.json())
      .then((d: { prompts: Prompt[] }) => {
        setPrompts(d.prompts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => { load(statusFilter || undefined); }, [statusFilter]);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 16 }}>
        <h2 style={{ margin: 0 }}>Prompts</h2>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          style={{ fontSize: 13, padding: '3px 8px', borderRadius: 6, border: '1px solid #d1d5db' }}
        >
          <option value="">All statuses</option>
          <option value="received">received</option>
          <option value="analyzing">analyzing</option>
          <option value="decomposed">decomposed</option>
          <option value="answered">answered</option>
          <option value="failed">failed</option>
        </select>
        <Link href="/reports/prompts" style={{ marginLeft: 'auto', color: '#6b7280', fontSize: 12 }}>
          Reports →
        </Link>
      </div>

      {loading && <div style={{ color: '#9ca3af' }}>Loading…</div>}

      {!loading && prompts.length === 0 && (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>
          No prompts yet. Use the <code>prompt_create</code> MCP tool or POST /prompts.
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>ID</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Body</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Status</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Via</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Elapsed</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Received</th>
          </tr>
        </thead>
        <tbody>
          {prompts.map(p => (
            <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 11 }}>
                <Link href={`/prompts/${p.id}`} style={{ color: '#2563eb' }}>{p.id.slice(0, 18)}</Link>
              </td>
              <td style={{ padding: '7px 10px', maxWidth: 360, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {p.body.slice(0, 120)}{p.body.length > 120 ? '…' : ''}
              </td>
              <td style={{ padding: '7px 10px' }}>{statusChip(p.status)}</td>
              <td style={{ padding: '7px 10px', color: '#6b7280' }}>{p.receivedVia}</td>
              <td style={{ padding: '7px 10px', color: '#6b7280' }}>
                {p.elapsedMs != null ? `${(p.elapsedMs / 1000).toFixed(1)}s` : '—'}
              </td>
              <td style={{ padding: '7px 10px', color: '#6b7280', fontSize: 12 }}>
                {new Date(p.receivedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
