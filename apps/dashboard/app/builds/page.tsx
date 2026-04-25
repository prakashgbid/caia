'use client';
import { useState, useEffect } from 'react';
import Link from 'next/link';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface BuildRun {
  id: string;
  trigger: string;
  gitSha?: string;
  branch?: string;
  status: string;
  outcome?: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  stepsTotal: number;
  stepsFailed: number;
}

const OUTCOME_COLOR: Record<string, string> = {
  success: '#16a34a',
  failure: '#dc2626',
  partial: '#d97706',
  running: '#2563eb',
};

function outcomeChip(status: string, outcome?: string) {
  const label = outcome ?? status;
  return (
    <span style={{
      background: OUTCOME_COLOR[label] ?? '#6b7280',
      color: '#fff',
      fontSize: 11,
      padding: '2px 8px',
      borderRadius: 12,
      fontWeight: 700,
    }}>{label}</span>
  );
}

export default function BuildsPage() {
  const [builds, setBuilds] = useState<BuildRun[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/builds?limit=50`)
      .then(r => r.json())
      .then((d: { builds: BuildRun[] }) => {
        setBuilds(d.builds ?? []);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      <h2 style={{ marginBottom: 16 }}>Build Runs</h2>

      {loading && <div style={{ color: '#9ca3af' }}>Loading…</div>}

      {!loading && builds.length === 0 && (
        <div style={{ color: '#9ca3af', padding: 40, textAlign: 'center' }}>
          No build runs yet. Run <code>npm run build:run</code> to record one.
        </div>
      )}

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>ID</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Outcome</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Trigger</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Branch</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>SHA</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Steps</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Duration</th>
            <th style={{ padding: '8px 10px', textAlign: 'left' }}>Started</th>
          </tr>
        </thead>
        <tbody>
          {builds.map(b => (
            <tr key={b.id} style={{ borderBottom: '1px solid #f3f4f6' }}>
              <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 11 }}>
                <Link href={`/builds/${b.id}`} style={{ color: '#2563eb' }}>{b.id.slice(0, 14)}</Link>
              </td>
              <td style={{ padding: '7px 10px' }}>{outcomeChip(b.status, b.outcome)}</td>
              <td style={{ padding: '7px 10px', color: '#6b7280' }}>{b.trigger}</td>
              <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 11 }}>{b.branch ?? '—'}</td>
              <td style={{ padding: '7px 10px', fontFamily: 'monospace', fontSize: 11 }}>{b.gitSha ?? '—'}</td>
              <td style={{ padding: '7px 10px' }}>
                <span style={{ color: b.stepsFailed > 0 ? '#dc2626' : '#16a34a' }}>
                  {b.stepsTotal - b.stepsFailed}/{b.stepsTotal}
                </span>
              </td>
              <td style={{ padding: '7px 10px', color: '#6b7280' }}>
                {b.durationMs ? `${(b.durationMs / 1000).toFixed(1)}s` : '—'}
              </td>
              <td style={{ padding: '7px 10px', color: '#6b7280', fontSize: 12 }}>
                {new Date(b.startedAt).toLocaleString()}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
