'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';

const API = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:7776';

interface Journey {
  promptId: string;
  receivedAt: string;
  status: string;
  elapsedMs?: number | null;
  timeToFirstTaskMs?: number | null;
  timeToAllDoneMs?: number | null;
  countByStatus: Record<string, number>;
  circuitBreakerTrips: number;
  reExecutionCount: number;
  totalEvents: number;
  descendants: {
    stories: number;
    requirements: number;
    tasks: number;
    taskRuns: number;
    blockers: number;
    questions: number;
    total: number;
  };
}

const STATUS_COLOR: Record<string, string> = {
  received: '#6b7280', analyzing: '#2563eb', decomposed: '#7c3aed',
  answered: '#16a34a', failed: '#dc2626',
  queued: '#9ca3af', running: '#2563eb', completed: '#16a34a',
  blocked: '#f59e0b', done: '#16a34a', pending: '#9ca3af',
};

function ms(v?: number | null): string {
  if (v == null) return '—';
  if (v < 1000) return `${v}ms`;
  if (v < 60_000) return `${(v / 1000).toFixed(1)}s`;
  return `${(v / 60_000).toFixed(1)}m`;
}

export default function PromptJourneyPage({ params }: { params: { id: string } }) {
  const { id } = params;
  const [journey, setJourney] = useState<Journey | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/prompts/${id}/journey`)
      .then(r => r.json())
      .then((d: Journey) => {
        setJourney(d);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  if (loading) return <div style={{ color: '#718096', padding: 32 }}>Loading…</div>;
  if (!journey) return (
    <div style={{ padding: 32 }}>
      <div style={{ color: '#fc8181', marginBottom: 12 }}>Prompt not found</div>
      <Link href="/prompts" style={{ color: '#63b3ed' }}>← Back</Link>
    </div>
  );

  const statusEntries = Object.entries(journey.countByStatus).sort((a, b) => b[1] - a[1]);
  const maxCount = Math.max(...statusEntries.map(e => e[1]), 1);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui', fontSize: 14 }}>
      {/* Breadcrumbs */}
      <div style={{ color: '#6b7280', fontSize: 12, marginBottom: 12 }}>
        <Link href="/prompts" style={{ color: '#6b7280' }}>Prompts</Link>
        {' → '}
        <Link href={`/prompts/${id}`} style={{ color: '#6b7280' }}>{id.slice(0, 20)}</Link>
        {' → '}
        Journey
      </div>

      <h2 style={{ marginBottom: 20 }}>Prompt Journey — #{id.slice(0, 14)}</h2>

      {/* Timing stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12, marginBottom: 28 }}>
        {[
          ['Status', journey.status],
          ['Total elapsed', ms(journey.elapsedMs)],
          ['→ First task', ms(journey.timeToFirstTaskMs)],
          ['→ All done', ms(journey.timeToAllDoneMs)],
          ['Total events', String(journey.totalEvents)],
          ['Circuit breaker trips', String(journey.circuitBreakerTrips)],
          ['Re-executions', String(journey.reExecutionCount)],
          ['Total descendants', String(journey.descendants.total)],
        ].map(([label, val]) => (
          <div key={String(label)} style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: '12px 16px' }}>
            <div style={{ color: '#6b7280', fontSize: 11, marginBottom: 6 }}>{label}</div>
            <div style={{ fontSize: 18, fontWeight: 700, color: '#1f2937', fontFamily: 'monospace' }}>{val}</div>
          </div>
        ))}
      </div>

      {/* Descendant breakdown */}
      <h3 style={{ marginBottom: 12 }}>Descendants by type</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 28 }}>
        {Object.entries(journey.descendants).filter(([k]) => k !== 'total').map(([type, cnt]) => (
          <div key={type} style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 6, padding: '8px 14px', minWidth: 100 }}>
            <div style={{ color: '#6b7280', fontSize: 11 }}>{type}</div>
            <div style={{ fontSize: 22, fontWeight: 700, color: '#1f2937' }}>{cnt}</div>
          </div>
        ))}
      </div>

      {/* Status distribution heatmap bar */}
      {statusEntries.length > 0 && (
        <>
          <h3 style={{ marginBottom: 12 }}>Status distribution</h3>
          <div style={{ marginBottom: 28 }}>
            {statusEntries.map(([status, cnt]) => (
              <div key={status} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
                <div style={{ width: 100, textAlign: 'right', color: '#374151', fontSize: 12 }}>{status}</div>
                <div style={{ flex: 1, background: '#f3f4f6', borderRadius: 4, height: 20, overflow: 'hidden' }}>
                  <div style={{
                    width: `${(cnt / maxCount) * 100}%`,
                    height: 20,
                    background: STATUS_COLOR[status] ?? '#6b7280',
                    borderRadius: 4,
                  }} />
                </div>
                <div style={{ width: 32, fontSize: 12, color: '#6b7280' }}>{cnt}</div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Sankey-style status flow (text representation) */}
      <h3 style={{ marginBottom: 12 }}>Status journey (lifecycle)</h3>
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, fontFamily: 'monospace', fontSize: 12, color: '#374151' }}>
        <div>Prompt: received → analyzing → decomposed → answered | failed</div>
        <div style={{ marginTop: 8 }}>Task: queued → ready → dispatched → running → gate_pending → gate_passed → sentinel_pending → sentinel_passed → done</div>
        <div style={{ marginTop: 8, color: '#9ca3af' }}>Side branches: gate_failed → rework_queued → ready | sentinel_flagged → bug_filed | paused | blocked | cancelled</div>
      </div>
    </div>
  );
}
