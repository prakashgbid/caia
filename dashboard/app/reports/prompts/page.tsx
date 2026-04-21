'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface Prompt {
  id: string;
  body: string;
  receivedAt: string;
  status: string;
  elapsedMs?: number | null;
  receivedVia: string;
}

interface DailyStat {
  date: string;
  total: number;
  answered: number;
  failed: number;
}

function buildDailyStats(prompts: Prompt[]): DailyStat[] {
  const map: Record<string, DailyStat> = {};
  for (const p of prompts) {
    const date = p.receivedAt.slice(0, 10);
    if (!map[date]) map[date] = { date, total: 0, answered: 0, failed: 0 };
    map[date].total++;
    if (p.status === 'answered') map[date].answered++;
    if (p.status === 'failed') map[date].failed++;
  }
  return Object.values(map).sort((a, b) => a.date.localeCompare(b.date));
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * 0.95);
  return sorted[Math.min(idx, sorted.length - 1)];
}

function ms(v: number): string {
  if (v < 1000) return `${Math.round(v)}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 60_000).toFixed(1)}m`;
}

export default function PromptsReportPage() {
  const [prompts, setPrompts] = useState<Prompt[]>([]);
  const [loading, setLoading] = useState(true);
  const [window, setWindow] = useState<'7d' | '30d'>('7d');

  const load = useCallback(() => {
    setLoading(true);
    const since = new Date(Date.now() - (window === '7d' ? 7 : 30) * 86_400_000).toISOString();
    fetch(`${API}/prompts?since=${encodeURIComponent(since)}&limit=200`)
      .then(r => r.json())
      .then((d: { prompts: Prompt[] }) => {
        setPrompts(d.prompts ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [window]);

  useEffect(() => { load(); }, [load]);

  const elapsed = prompts.filter(p => p.elapsedMs != null).map(p => p.elapsedMs as number);
  const medianMs = median(elapsed);
  const p95Ms = p95(elapsed);

  const byStatus: Record<string, number> = {};
  for (const p of prompts) byStatus[p.status] = (byStatus[p.status] ?? 0) + 1;

  const daily = buildDailyStats(prompts);
  const maxDaily = Math.max(...daily.map(d => d.total), 1);

  const slowest = [...prompts]
    .filter(p => p.elapsedMs != null)
    .sort((a, b) => (b.elapsedMs ?? 0) - (a.elapsedMs ?? 0))
    .slice(0, 5);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 20 }}>
        <div style={{ color: '#6b7280', fontSize: 12 }}>
          <Link href="/prompts" style={{ color: '#6b7280' }}>Prompts</Link> → Reports
        </div>
        <h2 style={{ margin: 0 }}>Prompt Reports</h2>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          {(['7d', '30d'] as const).map(w => (
            <button
              key={w}
              onClick={() => setWindow(w)}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: '1px solid #d1d5db',
                background: window === w ? '#2563eb' : '#fff',
                color: window === w ? '#fff' : '#374151',
                cursor: 'pointer',
                fontSize: 12,
              }}
            >{w}</button>
          ))}
        </div>
      </div>

      {loading && <div style={{ color: '#9ca3af' }}>Loading…</div>}

      {!loading && (
        <>
          {/* Summary stats */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 28 }}>
            {[
              ['Total prompts', String(prompts.length)],
              ['Answered', String(byStatus['answered'] ?? 0)],
              ['Failed', String(byStatus['failed'] ?? 0)],
              ['In progress', String((byStatus['received'] ?? 0) + (byStatus['analyzing'] ?? 0) + (byStatus['decomposed'] ?? 0))],
              ['Median time-to-done', ms(medianMs)],
              ['P95 time-to-done', ms(p95Ms)],
            ].map(([label, val]) => (
              <div key={String(label)} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px' }}>
                <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>{label}</div>
                <div style={{ fontSize: 20, fontWeight: 700, color: '#1f2937', fontFamily: 'monospace' }}>{val}</div>
              </div>
            ))}
          </div>

          {/* Prompts-per-day chart */}
          <h3 style={{ marginBottom: 12 }}>Prompts per day</h3>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, marginBottom: 8, padding: '0 4px' }}>
            {daily.map(d => (
              <div key={d.date} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                <div style={{ width: '100%', background: '#2563eb', height: `${(d.total / maxDaily) * 60}px`, borderRadius: '2px 2px 0 0', minHeight: d.total > 0 ? 4 : 0 }} />
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 4, marginBottom: 24 }}>
            {daily.map(d => (
              <div key={d.date} style={{ flex: 1, fontSize: 10, color: '#9ca3af', textAlign: 'center', overflow: 'hidden' }}>
                {d.date.slice(5)}
              </div>
            ))}
          </div>

          {/* Status-transition heatmap (distribution table) */}
          <h3 style={{ marginBottom: 12 }}>Status distribution</h3>
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
            {Object.entries(byStatus).sort((a, b) => b[1] - a[1]).map(([status, cnt]) => (
              <div key={status} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px' }}>
                <div style={{ color: '#6b7280', fontSize: 11 }}>{status}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#1f2937' }}>{cnt}</div>
              </div>
            ))}
          </div>

          {/* Slowest prompts */}
          <h3 style={{ marginBottom: 12 }}>Slowest prompts (top 5)</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: '#f9fafb' }}>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>ID</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Body</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Elapsed</th>
                <th style={{ padding: '6px 8px', textAlign: 'left' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {slowest.map(p => (
                <tr key={p.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
                  <td style={{ padding: '5px 8px', fontFamily: 'monospace', fontSize: 11 }}>
                    <Link href={`/prompts/${p.id}`} style={{ color: '#2563eb' }}>{p.id.slice(0, 16)}</Link>
                  </td>
                  <td style={{ padding: '5px 8px', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.body.slice(0, 80)}
                  </td>
                  <td style={{ padding: '5px 8px', fontFamily: 'monospace' }}>{ms(p.elapsedMs ?? 0)}</td>
                  <td style={{ padding: '5px 8px', color: '#6b7280' }}>{p.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
